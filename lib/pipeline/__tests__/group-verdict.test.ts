import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaActionGroupWithOutcomes as realGroup } from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome, PipelineAction, RowGuard, RowGuardArgs } from '@/lib/actions/types'
import { deltas, happenings, lore } from '@/lib/db'
import {
  configureDeltaActionPort,
  definePipeline,
  emitDeltaGroup,
  pipelineEventBus,
  runPipeline,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { readRowGuard } from '@/lib/pipeline/runtime/action-port'

import { expectRan, makeHarness, realDeltaActionPort, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

type Phase = (
  ctx: PhaseContext,
) => AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined>

const createHappening = (id: string): PipelineAction => ({
  kind: 'createHappening',
  source: 'chapter_close',
  payload: {
    entry: { id, branchId: 'b1', title: `Happening ${id}`, createdAt: 1, updatedAt: 1 },
  },
})

// The seeded row's own body: its handler noops the restatement.
const restateLore: PipelineAction = {
  kind: 'updateLore',
  source: 'chapter_close',
  payload: {
    branchId: 'b1',
    id: 'lore_known',
    patch: { body: 'Ash fell for a year.' },
    proseEntryId: null,
  },
}

const updateMissingLore: PipelineAction = {
  kind: 'updateLore',
  source: 'chapter_close',
  payload: {
    branchId: 'b1',
    id: 'lore_missing',
    patch: { body: 'Never written.' },
    proseEntryId: null,
  },
}

const RESTATED = { status: 'noop', reason: 'no-op lore patch', mark: 'restated' } as const
const MISSING = 'update target lore b1:lore_missing not found'

let h: Awaited<ReturnType<typeof makeHarness>>

beforeEach(async () => {
  resetSingletons()
  h = await makeHarness()
  await h.db.insert(lore).values({
    id: 'lore_known',
    branchId: 'b1',
    title: 'The Ashfall',
    body: 'Ash fell for a year.',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
})

afterEach(() => {
  resetSingletons()
})

function define(kind: string, run: Phase): void {
  definePipeline({ kind, phases: [{ name: 'write', run }], ...base })
}

function deltasOf(actionId: string) {
  return h.db.select().from(deltas).where(eq(deltas.actionId, actionId))
}

describe('emitDeltaGroup', () => {
  it('yields one delta_group_emitted and returns the outcome sent back', () => {
    const actions = [createHappening('hap_a')]
    const gen = emitDeltaGroup(actions, 'entry_end')
    expect(gen.next()).toEqual({
      done: false,
      value: { type: 'delta_group_emitted', actions, entryId: 'entry_end' },
    })
    const outcome: GroupOutcome = { status: 'ok', outcomes: [{ status: 'landed' }] }
    expect(gen.next(outcome)).toEqual({ done: true, value: outcome })
  })

  it('throws when nothing comes back, as a phase driven outside the orchestrator would see', () => {
    const gen = emitDeltaGroup([createHappening('hap_a')], 'entry_end')
    gen.next()
    expect(() => gen.next(undefined)).toThrow(
      'delta_group_emitted: the orchestrator sent no outcome back',
    )
  })
})

describe('a delta_group_emitted yield', () => {
  it("evaluates to each action's outcome at its index, in a plain phase", async () => {
    const seen: GroupOutcome[] = []
    define('group-plain', async function* () {
      seen.push(yield* emitDeltaGroup([createHappening('hap_a'), restateLore], 'entry_end'))
      return { status: 'completed' }
    })

    const run = expectRan(await runPipeline('group-plain', h.ctx))

    expect(run.outcome).toBe('completed')
    expect(seen).toEqual([{ status: 'ok', outcomes: [{ status: 'landed' }, RESTATED] }])
    const written = await deltasOf(run.actionId)
    expect(written.map((d) => [d.targetTable, d.targetId, d.entryId, d.source])).toEqual([
      ['happenings', 'hap_a', 'entry_end', 'chapter_close'],
    ])
  })

  it('gives each branch of a parallel group its own outcome', async () => {
    const seen: Record<string, GroupOutcome> = {}
    const branch = (name: string, actions: readonly PipelineAction[]): Phase =>
      async function* () {
        seen[name] = yield* emitDeltaGroup(actions, `entry_${name}`)
        return { status: 'completed' }
      }
    definePipeline({
      kind: 'group-parallel',
      phases: [
        {
          name: 'both',
          parallel: [
            { name: 'a', run: branch('a', [createHappening('hap_a')]) },
            { name: 'b', run: branch('b', [restateLore]) },
          ],
        },
      ],
      ...base,
    })

    const run = expectRan(await runPipeline('group-parallel', h.ctx))

    expect(run.outcome).toBe('completed')
    expect(seen).toEqual({
      a: { status: 'ok', outcomes: [{ status: 'landed' }] },
      b: { status: 'ok', outcomes: [RESTATED] },
    })
  })

  it('hands a whole-group refusal back as a value, and the run goes on to complete', async () => {
    const seen: GroupOutcome[] = []
    define('group-refused', async function* () {
      seen.push(yield* emitDeltaGroup([createHappening('hap_a'), updateMissingLore], 'entry_end'))
      return { status: 'completed' }
    })

    const run = expectRan(await runPipeline('group-refused', h.ctx))

    expect(run.outcome).toBe('completed')
    expect(seen).toEqual([{ status: 'rejected', reason: MISSING, code: 'not-found' }])
    expect(await deltasOf(run.actionId)).toEqual([])
    expect(await h.db.select().from(happenings)).toEqual([])
  })

  it('fails the run as action-layer when the action layer throws', async () => {
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      applyDeltaActionGroupWithOutcomes: async () => {
        throw new Error('disk I/O error')
      },
    })
    define('group-throws', async function* () {
      yield* emitDeltaGroup([createHappening('hap_a')], 'entry_end')
      return { status: 'completed' }
    })

    const run = expectRan(await runPipeline('group-throws', h.ctx))

    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({ kind: 'action-layer', detail: 'disk I/O error' })
  })

  it('reaches the bus once the group has committed', async () => {
    const order: string[] = []
    const heard: unknown[] = []
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      applyDeltaActionGroupWithOutcomes: async (...args) => {
        const outcome = await realGroup(...args)
        order.push('committed')
        return outcome
      },
    })
    pipelineEventBus.subscribe('delta_group_emitted', (event) => {
      order.push('bus')
      heard.push(event)
    })
    const actions = [createHappening('hap_a')]
    define('group-bus', async function* () {
      yield* emitDeltaGroup(actions, 'entry_end')
      return { status: 'completed' }
    })

    await runPipeline('group-bus', h.ctx)

    expect(order).toEqual(['committed', 'bus'])
    expect(heard).toEqual([{ type: 'delta_group_emitted', actions, entryId: 'entry_end' }])
  })
})

describe('a delta_emitted yield', () => {
  it('evaluates to undefined, and a refusal that is not a noop still fails the run', async () => {
    const seen: (GroupOutcome | undefined)[] = []
    define('single-refused', async function* () {
      seen.push(
        yield { type: 'delta_emitted', action: createHappening('hap_a'), entryId: 'entry_end' },
      )
      yield { type: 'delta_emitted', action: updateMissingLore, entryId: 'entry_end' }
      return { status: 'completed' }
    })

    const run = expectRan(await runPipeline('single-refused', h.ctx))

    expect(seen).toEqual([undefined])
    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({ kind: 'action-layer', detail: MISSING })
    // The abort reversed the write that had landed.
    expect(await h.db.select().from(happenings)).toEqual([])
  })
})

describe('a yield after a group', () => {
  it('evaluates to undefined, not the group outcome before it', async () => {
    const seen: (GroupOutcome | undefined)[] = []
    define('group-then-single', async function* () {
      yield* emitDeltaGroup([createHappening('hap_a')], 'entry_end')
      seen.push(
        yield { type: 'delta_emitted', action: createHappening('hap_b'), entryId: 'entry_end' },
      )
      return { status: 'completed' }
    })

    const run = expectRan(await runPipeline('group-then-single', h.ctx))

    expect(run.outcome).toBe('completed')
    expect(seen).toEqual([undefined])
  })
})

describe('readRowGuard', () => {
  it('reaches a phase through the port', async () => {
    const guard: RowGuard = {
      row: () => ({
        laterTurnWrote: () => false,
        userWrote: () => true,
        userEverWrote: () => true,
        laterTurnTouched: () => false,
        userTouched: () => true,
      }),
    }
    const asked: RowGuardArgs[] = []
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      readRowGuard: async (args) => {
        asked.push(args)
        return guard
      },
    })
    const args: RowGuardArgs = {
      branchId: 'b1',
      endEntryId: 'entry_end',
      proseEntryId: 'entry_prose',
      rows: [{ table: 'lore', id: 'lore_known' }],
    }
    const got: RowGuard[] = []
    define('guard-read', async function* (ctx) {
      got.push(await readRowGuard(args, { db: ctx.db, runInTransaction: ctx.runInTransaction }))
      return { status: 'completed' }
    })

    await runPipeline('guard-read', h.ctx)

    expect(asked).toEqual([args])
    expect(got).toHaveLength(1)
    expect(got[0]).toBe(guard)
  })
})
