import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { deltas, entities, pipelineRuns, storyEntries } from '@/lib/db'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import { definePipeline, runPipeline, type PhaseResult } from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const NOOP_ENTITY = 'char_00000000-0000-4000-8000-0000000000aa'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

const newEntry = (id: string): PipelineAction => ({
  kind: 'createStoryEntry',
  source: 'ai_classifier',
  payload: {
    entry: { id, branchId: 'b1', position: 1, kind: 'ai_reply', content: 'hi', createdAt: 1 },
  },
})

// Emits the same entry twice → second INSERT violates the PK → applyDeltaAction throws.
async function* doubleCreate(): AsyncGenerator<
  { type: 'delta_emitted'; action: PipelineAction },
  PhaseResult
> {
  yield { type: 'delta_emitted', action: newEntry('entry_dup') }
  yield { type: 'delta_emitted', action: newEntry('entry_dup') }
  return { status: 'completed' }
}

// Updates a row that does not exist → applyDeltaAction returns { status: 'rejected' }.
async function* updateMissing(): AsyncGenerator<
  { type: 'delta_emitted'; action: PipelineAction },
  PhaseResult
> {
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateStoryEntryMetadata',
      source: 'ai_classifier',
      payload: {
        branchId: 'b1',
        id: 'ghost',
        metadata: { sceneEntities: [], currentLocationId: null, worldTime: 1 },
      },
    },
  }
  return { status: 'completed' }
}

// Patches an entity's state with the values it already holds → the handler
// rejects with code 'noop'.
async function* redundantStatePatch(): AsyncGenerator<
  { type: 'delta_emitted'; action: PipelineAction },
  PhaseResult
> {
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateEntityVisualState',
      source: 'per_turn_classifier',
      payload: { branchId: 'b1', id: NOOP_ENTITY, visual: { attire: 'plate' } },
    },
  }
  return { status: 'completed' }
}

async function* throwsDirectly(): AsyncGenerator<never, PhaseResult> {
  throw new Error('phase blew up')
}

async function* completesCleanly(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

async function* failsCleanly(): AsyncGenerator<never, PhaseResult> {
  return { status: 'failed', error: { kind: 'phase-logic', detail: 'clean fail' } }
}

describe('orchestrator hardening', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('an unexpected action throw routes to abortRun with full cleanup', async () => {
    const { db, ctx } = await makeHarness()
    definePipeline({ kind: 'throwy', phases: [{ name: 'p', run: doubleCreate }], ...base })

    const result = expectRan(await runPipeline('throwy', ctx))

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('action-layer')
    // first create reverse-replayed away
    const rows = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_dup')))
    expect(rows.length).toBe(0)
    const [pr] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, result.runId))
    expect(pr.outcome).toBe('failed')
    expect(pr.finishedAt).not.toBeNull()
    const turn = getDiagnosticsSnapshot().turnCaptures.find((t) => t.actionId === result.actionId)
    expect(turn?.endedAt).toBeDefined() // turn finalized
    expect(generationStore.getTxState().runs.size).toBe(0) // active run released
  })

  it('a rejected MutationResult routes to abortRun as an action-layer error', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'rejecty', phases: [{ name: 'p', run: updateMissing }], ...base })

    const result = expectRan(await runPipeline('rejecty', ctx))

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('action-layer')
  })

  // A model restating current state is ordinary, and an unmarked rejection cost
  // the user the entire turn: the run failed and the reversal sweep took the
  // committed prose with it. The 'noop' code exists to say "well-formed, changed
  // nothing"; before this it was written by handlers and read by nobody.
  it('skips a noop-coded rejection instead of failing the run', async () => {
    const { db, ctx } = await makeHarness()
    await db.insert(entities).values({
      id: NOOP_ENTITY,
      branchId: 'b1',
      kind: 'character',
      name: 'Mara',
      description: 'A knight.',
      status: 'active',
      injectionMode: 'auto',
      state: { visual: { attire: 'plate' } },
      createdAt: 1,
      updatedAt: 1,
    } as never)
    definePipeline({ kind: 'noopy', phases: [{ name: 'p', run: redundantStatePatch }], ...base })

    const result = expectRan(await runPipeline('noopy', ctx))

    expect(result.outcome).toBe('completed')
    // Nothing to undo, so nothing is logged.
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('a non-action throw from a phase body maps to an orchestrator error', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'boom', phases: [{ name: 'p', run: throwsDirectly }], ...base })

    const result = expectRan(await runPipeline('boom', ctx))

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('orchestrator')
  })

  it('a marker-write failure on commit finishes cleanly without leaking state', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'commitfail', phases: [{ name: 'p', run: completesCleanly }], ...base })
    const db = new Proxy(ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return () => {
            throw new Error('marker write failed')
          }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const result = expectRan(await runPipeline('commitfail', { ...ctx, db }))

    expect(result.outcome).toBe('completed') // run logically completed; marker failure swallowed
    expect(generationStore.getTxState().runs.size).toBe(0) // active run released
    expect(
      getDiagnosticsSnapshot().logEntries.some((e) => e.kind === 'pipeline.marker_write_failed'),
    ).toBe(true)
  })

  it('a marker-write failure on abort finishes cleanly without leaking state', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'abortfail', phases: [{ name: 'p', run: failsCleanly }], ...base })
    const db = new Proxy(ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return () => {
            throw new Error('marker write failed')
          }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const result = expectRan(await runPipeline('abortfail', { ...ctx, db }))

    expect(result.outcome).toBe('failed')
    expect(generationStore.getTxState().runs.size).toBe(0)
  })
})
