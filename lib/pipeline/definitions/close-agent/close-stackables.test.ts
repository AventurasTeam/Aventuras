import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'
import type { ResolveModelConfig } from '@/lib/ai'
import type { ChapterPartCut } from '@/lib/chapters'
import { deltas, emptyEntityState, entities, type EntityState } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { normalizeStackablesStep } from './close-stackables'
import { CloseIds } from './ids'
import { __setCloseAgentSlots, type CodeStepContext } from './slots'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeLedgerOf, setCloseParts, setCloseRange } from '../close-intermediates'

const WREN = 'char_00000000-0000-4000-8000-00000000f001'
const TOBIN = 'char_00000000-0000-4000-8000-00000000f002'
const MARA = 'char_00000000-0000-4000-8000-00000000f003'
const ACTION_ID = 'act_close_stackables'
// No task runs, so the config is only carried.
const CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

// The chapter runs from the opening to the third reply (t1…t7); E is that reply.
const endEntryIdOf = (fx: CloseFixture): string => fx.entries[6]!.id
const chapterEntryIdsOf = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map(({ id }) => id)

type At = { actionId: string; entryId: string | null }
const SEEDED: At = { actionId: 'act_seed_world', entryId: null }
const BY_USER: At = { actionId: 'act_user_edit', entryId: null }
// Anchored on the fifth reply, past E, under the turn that wrote it.
const byLaterTurn = (fx: CloseFixture): At => ({
  actionId: 'act_close_turn_5',
  entryId: fx.replyIds[4]!,
})

async function apply(fx: CloseFixture, action: PipelineAction, at: At = SEEDED): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: at.actionId, branchId: fx.branchId, entryId: at.entryId },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

async function seedCharacter(
  fx: CloseFixture,
  id: string,
  name: string,
  stackables?: Record<string, number>,
): Promise<void> {
  const state = {
    ...emptyEntityState('character'),
    ...(stackables === undefined ? {} : { stackables }),
  } as EntityState
  await apply(fx, {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id,
        branchId: fx.branchId,
        kind: 'character',
        name,
        description: null,
        status: 'active',
        injectionMode: 'auto',
        state,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  })
}

function writeStackables(
  fx: CloseFixture,
  id: string,
  stackables: Record<string, number>,
  source: 'user_edit' | 'per_turn_classifier',
): PipelineAction {
  return {
    kind: 'updateEntityStackables',
    source,
    payload: { branchId: fx.branchId, id, stackables },
  }
}

async function stackablesOf(fx: CloseFixture, id: string): Promise<unknown> {
  const [row] = await fx.ctx.db
    .select({ state: entities.state })
    .from(entities)
    .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, id)))
  return (row?.state as { stackables?: unknown } | null)?.stackables
}

function runDeltas(fx: CloseFixture) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, ACTION_ID))
    .orderBy(asc(deltas.logPosition))
}

function phaseFor(fx: CloseFixture, abortSignal = new AbortController().signal): PhaseContext {
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, {
    chapterId: 'chap_stackables',
    startEntryId: fx.entries[0]!.id,
    endEntryId: endEntryIdOf(fx),
  })
  const cut: ChapterPartCut = {
    part: 1,
    startEntryId: fx.entries[0]!.id,
    endEntryId: endEntryIdOf(fx),
    tokens: 0,
  }
  setCloseParts(intermediates, [cut])
  return {
    actionId: ACTION_ID,
    abortSignal,
    intermediates,
    log: makeLogger(ACTION_ID),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

type GroupEvent = Extract<PhaseEmittedEvent, { type: 'delta_group_emitted' }>

// Stands in for the orchestrator over the agent phase: `answer` settles each group, else it lands.
async function drain(
  ctx: PhaseContext,
  fx: CloseFixture,
  answer?: (event: GroupEvent) => GroupOutcome,
): Promise<{ groups: GroupEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const groups: GroupEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { groups, result: next.value }
    const event = next.value
    if (event.type !== 'delta_group_emitted') {
      reply = undefined
      continue
    }
    groups.push(event)
    reply =
      answer?.(event) ??
      (await applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: ctx.actionId, branchId: ctx.branchId, entryId: event.entryId },
        fx.ctx,
      ))
  }
}

function stepContext(fx: CloseFixture, abortSignal: AbortSignal): CodeStepContext {
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: endEntryIdOf(fx),
    part: 0,
    taskEntryIds: chapterEntryIdsOf(fx),
    ids: new CloseIds(),
    survivorOf: () => undefined,
    landedCalls: () => 0,
    clusterOf: () => undefined,
    phase: phaseFor(fx, abortSignal),
    config: CONFIG,
  }
}

describe('normalizeStackablesStep', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    __setCloseAgentSlots({
      before: [{ kind: 'code', step: normalizeStackablesStep }],
      perPart: [],
      after: [],
    })
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it('folds { Gold: 5, gold: 3 } into { gold: 8 }: one chapter_close delta on E, nothing in the ledger', async () => {
    expect(normalizeStackablesStep.name).toBe('stackables')
    await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })
    const ctx = phaseFor(f)

    const { groups, result } = await drain(ctx, f)

    expect(result).toEqual({ status: 'completed' })
    expect(groups).toEqual([
      {
        type: 'delta_group_emitted',
        entryId: endEntryIdOf(f),
        actions: [
          {
            kind: 'updateEntityStackables',
            source: 'chapter_close',
            payload: { branchId: f.branchId, id: WREN, stackables: { gold: 8 } },
          },
        ],
      },
    ])
    expect(await stackablesOf(f, WREN)).toEqual({ gold: 8 })
    const written = await runDeltas(f)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      source: 'chapter_close',
      entryId: endEntryIdOf(f),
      targetTable: 'entities',
      targetId: WREN,
      op: 'update',
    })
    expect(closeLedgerOf(ctx.intermediates)).toEqual({
      calls: [],
      stopped: [],
      noToolCalls: true,
    })
  })

  it("folds a plural onto a singular another character holds, leaving that character's record alone", async () => {
    await seedCharacter(f, TOBIN, 'Tobin', { arrow: 2 })
    await seedCharacter(f, MARA, 'Mara', { arrows: 3 })

    const { groups } = await drain(phaseFor(f), f)

    expect(groups.flatMap((group) => group.actions)).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'chapter_close',
        payload: { branchId: f.branchId, id: MARA, stackables: { arrow: 3 } },
      },
    ])
    expect(await stackablesOf(f, MARA)).toEqual({ arrow: 3 })
    expect(await stackablesOf(f, TOBIN)).toEqual({ arrow: 2 })
  })

  it('emits no group for a record with nothing to fold', async () => {
    await seedCharacter(f, WREN, 'Wren', { gold: 8, arrow: 2 })

    const { groups, result } = await drain(phaseFor(f), f)

    expect(result).toEqual({ status: 'completed' })
    expect(groups).toEqual([])
    expect(await runDeltas(f)).toEqual([])
  })

  it('emits no group for a character with no record or an empty one', async () => {
    await seedCharacter(f, TOBIN, 'Tobin')
    await seedCharacter(f, MARA, 'Mara', {})

    const { groups } = await drain(phaseFor(f), f)

    expect(groups).toEqual([])
    expect(await runDeltas(f)).toEqual([])
  })

  it('leaves a record the user wrote after E alone, and normalizes the others', async () => {
    await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })
    await seedCharacter(f, MARA, 'Mara', { Arrows: 1, arrows: 2 })
    await apply(f, writeStackables(f, WREN, { Gold: 6, gold: 3 }, 'user_edit'), BY_USER)

    const { groups } = await drain(phaseFor(f), f)

    expect(groups.flatMap((group) => group.actions)).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'chapter_close',
        payload: { branchId: f.branchId, id: MARA, stackables: { arrows: 3 } },
      },
    ])
    expect(await stackablesOf(f, WREN)).toEqual({ Gold: 6, gold: 3 })
    expect(await stackablesOf(f, MARA)).toEqual({ arrows: 3 })
  })

  it('folds onto a singular only a record the user wrote holds, leaving that record alone', async () => {
    await seedCharacter(f, TOBIN, 'Tobin', { arrow: 1 })
    await seedCharacter(f, MARA, 'Mara', { arrows: 3 })
    await apply(f, writeStackables(f, TOBIN, { arrow: 2 }, 'user_edit'), BY_USER)

    const { groups } = await drain(phaseFor(f), f)

    expect(groups.flatMap((group) => group.actions)).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'chapter_close',
        payload: { branchId: f.branchId, id: MARA, stackables: { arrow: 3 } },
      },
    ])
    expect(await stackablesOf(f, TOBIN)).toEqual({ arrow: 2 })
  })

  it('leaves a record a later turn wrote alone, and normalizes the others', async () => {
    await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })
    await seedCharacter(f, MARA, 'Mara', { Arrows: 1, arrows: 2 })
    await apply(
      f,
      writeStackables(f, WREN, { Gold: 4, gold: 3 }, 'per_turn_classifier'),
      byLaterTurn(f),
    )

    const { groups } = await drain(phaseFor(f), f)

    expect(groups.flatMap((group) => group.actions)).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'chapter_close',
        payload: { branchId: f.branchId, id: MARA, stackables: { arrows: 3 } },
      },
    ])
    expect(await stackablesOf(f, WREN)).toEqual({ Gold: 4, gold: 3 })
  })

  it('fails the close when its group is refused', async () => {
    await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })

    const { result } = await drain(phaseFor(f), f, () => ({
      status: 'rejected',
      reason: 'scripted refusal',
    }))

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'action-layer', detail: 'stackable normalization refused: scripted refusal' },
    })
    expect(await stackablesOf(f, WREN)).toEqual({ Gold: 5, gold: 3 })
  })

  // The nth read of `aborted` and every one after it say so; polls are counted, not timed.
  const abortsAtRead = (nth: number): AbortSignal => {
    let reads = 0
    return {
      get aborted() {
        return ++reads >= nth
      },
    } as AbortSignal
  }

  it.each([2, 3, 4])(
    'returns aborted, emitting nothing, when the close is cancelled at poll %i of two characters',
    async (nth) => {
      await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })
      await seedCharacter(f, MARA, 'Mara', { Arrows: 1, arrows: 2 })

      const gen = normalizeStackablesStep.run(stepContext(f, abortsAtRead(nth)))

      expect(await gen.next(undefined)).toEqual({ done: true, value: { status: 'aborted' } })
      expect(await runDeltas(f)).toEqual([])
    },
  )

  it('returns aborted for a cancelled close with nothing to fold', async () => {
    await seedCharacter(f, WREN, 'Wren', { gold: 8 })
    const controller = new AbortController()
    controller.abort()

    const gen = normalizeStackablesStep.run(stepContext(f, controller.signal))

    expect(await gen.next(undefined)).toEqual({ done: true, value: { status: 'aborted' } })
  })

  it('returns aborted, emitting nothing, when the close is cancelled', async () => {
    await seedCharacter(f, WREN, 'Wren', { Gold: 5, gold: 3 })
    const controller = new AbortController()
    controller.abort()

    const gen = normalizeStackablesStep.run(stepContext(f, controller.signal))

    expect(await gen.next(undefined)).toEqual({ done: true, value: { status: 'aborted' } })
    expect(await stackablesOf(f, WREN)).toEqual({ Gold: 5, gold: 3 })
  })
})
