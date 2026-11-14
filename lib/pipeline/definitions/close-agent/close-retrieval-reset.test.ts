import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome } from '@/lib/actions/types'
import { generateToolStep } from '@/lib/ai'
import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happenings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { loadHistoryChunk } from '@/lib/history'
import { resetAllStores } from '@/lib/stores'

import { awarenessTask, resetRetrievalStep } from './close-awareness'
import { __setCloseAgentSlots, type CloseAgentSlots, type CodeStepContext } from './slots'
import type { PhaseEmittedEvent, PhaseResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeLedgerOf } from '../close-intermediates'
import {
  ARIA,
  JORIN,
  FIGHT,
  TOLL,
  RUMOUR,
  A_CHAPTER,
  A_BOTH,
  A_FREQUENT,
  A_IDLE,
  A_COMMON,
  COUNTS,
  endOf,
  seedAwarenessWorld,
  chapterIds,
  promptContextFor,
  stepWith,
  closePhaseFor,
  drainApplying,
} from './__tests__/close-awareness-fixture'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

type GroupEvent = Extract<PhaseEmittedEvent, { type: 'delta_group_emitted' }>

/** A code step's context over the chapter, as the agent phase builds it: no task, no ledger. */
function stepContextFor(fx: CloseFixture, abortSignal?: AbortSignal): CodeStepContext {
  const {
    task: _task,
    readFields: _readFields,
    ...step
  } = promptContextFor(fx, chapterIds(fx), abortSignal)
  return step
}

// The step alone, each group answered by `reply`.
async function runReset(
  ctx: CodeStepContext,
  reply: (event: GroupEvent) => Promise<GroupOutcome>,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = resetRetrievalStep.run(ctx)
  const events: PhaseEmittedEvent[] = []
  let answer: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(answer)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
    answer = next.value.type === 'delta_group_emitted' ? await reply(next.value) : undefined
  }
}

async function countsOf(fx: CloseFixture): Promise<Record<string, number>> {
  const rows = await fx.ctx.db
    .select({ id: happeningAwareness.id, count: happeningAwareness.retrievalCount })
    .from(happeningAwareness)
    .where(eq(happeningAwareness.branchId, fx.branchId))
  return Object.fromEntries(rows.map(({ id, count }) => [id, count]))
}

const ALL_RESET = { [A_CHAPTER]: 0, [A_BOTH]: 0, [A_FREQUENT]: 0, [A_IDLE]: 0, [A_COMMON]: 0 }

const AWARENESS_AND_RESET: CloseAgentSlots = {
  before: [],
  perPart: [],
  after: [
    { kind: 'task', def: awarenessTask },
    { kind: 'code', step: resetRetrievalStep },
  ],
}

describe('the retrieval reset', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(stepWith([]))
    fx = await openCloseFixture()
    await seedAwarenessWorld(fx)
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it('zeroes every count on the branch after Awareness, one chapter_close delta a row on E in one group, none in History', async () => {
    // A pass's source edit of Aria's row of the fight: the History control below.
    const edited = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: {
            branchId: fx.branchId,
            characterId: ARIA,
            happeningId: FIGHT,
            source: 'saw it from the bank',
            proseEntryId: null,
          },
        },
        actionId: 'act_source_edit',
        branchId: fx.branchId,
        entryId: null,
      },
      fx.ctx,
    )
    expect(edited.status).toBe('ok')
    const [sourceEdit] = await fx.ctx.db
      .select({ id: deltas.id })
      .from(deltas)
      .where(eq(deltas.actionId, 'act_source_edit'))
    __setCloseAgentSlots(AWARENESS_AND_RESET)
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(await countsOf(fx)).toEqual(ALL_RESET)
    const groups = events.flatMap((event) => (event.type === 'delta_group_emitted' ? [event] : []))
    expect(
      groups.map(({ entryId, actions }) => [entryId, actions.map(({ kind }) => kind)]),
    ).toEqual([
      [
        endOf(fx),
        ['resetAwarenessRetrieval', 'resetAwarenessRetrieval', 'resetAwarenessRetrieval'],
      ],
    ])
    const resets = await fx.ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, ctx.actionId))
      .orderBy(asc(deltas.logPosition))
    expect(
      resets.map((d) => [d.targetTable, d.targetId, d.op, d.source, d.entryId, d.undoPayload]),
    ).toEqual([
      [
        'happening_awareness',
        A_BOTH,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.both },
      ],
      [
        'happening_awareness',
        A_FREQUENT,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.frequent },
      ],
      [
        'happening_awareness',
        A_COMMON,
        'update',
        'chapter_close',
        endOf(fx),
        { retrievalCount: COUNTS.common },
      ],
    ])
    const resetIds = new Set(resets.map(({ id }) => id))
    const historyOf = async (targetId: string): Promise<string[]> =>
      (
        await loadHistoryChunk(fx.ctx.db, {
          branchId: fx.branchId,
          targetTable: 'happenings',
          targetId,
          sort: 'newest',
          cursor: null,
        })
      ).rows.map(({ delta }) => delta.id)
    for (const happeningId of [FIGHT, TOLL, RUMOUR])
      expect(
        (await historyOf(happeningId)).filter((id) => resetIds.has(id)),
        happeningId,
      ).toEqual([])
    // Control: History does read the fight's awareness rows; only the counts stay out.
    expect(await historyOf(FIGHT)).toContain(sourceEdit!.id)
  })

  it('resets after an Awareness task stopped at its budget', async () => {
    let step = 0
    vi.mocked(generateToolStep).mockImplementation(async () => {
      step += 1
      return stepWith([
        { toolCallId: `r${step}`, toolName: 'read_turns', input: { turns: ['t2'] } },
      ])
    })
    __setCloseAgentSlots(AWARENESS_AND_RESET)
    const ctx = closePhaseFor(fx)

    const { result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(closeLedgerOf(ctx.intermediates)?.stopped).toEqual([
      { task: 'awareness', part: 0, reason: 'budget' },
    ])
    expect(await countsOf(fx)).toEqual(ALL_RESET)
  })

  it('emits no group when no count on the branch is above 0', async () => {
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ retrievalCount: 0 })
      .where(eq(happeningAwareness.branchId, fx.branchId))

    const { events, result } = await runReset(stepContextFor(fx), async () => {
      throw new Error('no group was owed')
    })

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
  })

  it('resets only this branch when a sibling branch holds a count above 0', async () => {
    const OTHER_BRANCH = 'br_other'
    await fx.ctx.db
      .insert(branches)
      .values({ id: OTHER_BRANCH, storyId: fx.storyId, name: 'other', createdAt: 1 })
    await fx.ctx.db.insert(entities).values({
      id: JORIN,
      branchId: OTHER_BRANCH,
      kind: 'character',
      name: 'Sibling Jorin',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      keywords: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happenings).values({
      id: FIGHT,
      branchId: OTHER_BRANCH,
      title: 'Sibling fight',
      description: null,
      category: null,
      icon: null,
      temporal: null,
      occurredAtEntryId: fx.entries[4]!.id,
      commonKnowledge: 0,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happeningAwareness).values({
      id: A_BOTH,
      branchId: OTHER_BRANCH,
      happeningId: FIGHT,
      characterId: JORIN,
      learnedAtEntryId: fx.entries[5]!.id,
      decayResistance: 0,
      retrievalCount: 9,
    })

    const { events, result } = await runReset(stepContextFor(fx), (event) =>
      applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: 'act_reset_step', branchId: fx.branchId, entryId: event.entryId },
        fx.ctx,
      ),
    )

    expect(result).toEqual({ status: 'completed' })
    const [group] = events.flatMap((event) => (event.type === 'delta_group_emitted' ? [event] : []))
    expect(
      group?.actions.flatMap((action) =>
        action.kind === 'resetAwarenessRetrieval' ? [action.payload.id] : [],
      ),
    ).toEqual([A_BOTH, A_FREQUENT, A_COMMON])
    const sibling = await fx.ctx.db
      .select({ count: happeningAwareness.retrievalCount })
      .from(happeningAwareness)
      .where(eq(happeningAwareness.branchId, OTHER_BRANCH))
    expect(sibling).toEqual([{ count: 9 }])
  })

  it('stops before emitting when the close is aborted', async () => {
    const abort = new AbortController()
    abort.abort()

    const { events, result } = await runReset(stepContextFor(fx, abort.signal), async () => {
      throw new Error('no group was owed')
    })

    expect(result).toEqual({ status: 'aborted' })
    expect(events).toEqual([])
    expect((await countsOf(fx))[A_FREQUENT]).toBe(COUNTS.frequent)
  })

  it('fails the close when its group is refused: a code step has no model to tell', async () => {
    const debug = vi.spyOn(logger, 'debug')
    onTestFinished(() => debug.mockRestore())

    const { events, result } = await runReset(stepContextFor(fx), async () => ({
      status: 'rejected',
      reason: 'scripted refusal',
    }))

    expect(events).toHaveLength(1)
    expect(result).toEqual({
      status: 'failed',
      error: {
        kind: 'action-layer',
        detail: 'retrieval reset refused: scripted refusal',
        tableName: 'happening_awareness',
      },
    })
    expect(debug.mock.calls.filter(([kind]) => kind === 'memory.close_retrieval_reset')).toEqual([
      [
        'memory.close_retrieval_reset',
        { rows: 3, status: 'rejected', ms: expect.any(Number) },
        { actionId: 'act_awareness_start' },
      ],
    ])
  })

  it('logs the group as memory.close_retrieval_reset with its rows, status and round trip', async () => {
    const debug = vi.spyOn(logger, 'debug')
    onTestFinished(() => debug.mockRestore())

    await runReset(stepContextFor(fx), (event) =>
      applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: 'act_reset_step', branchId: fx.branchId, entryId: event.entryId },
        fx.ctx,
      ),
    )

    expect(debug.mock.calls.filter(([kind]) => kind === 'memory.close_retrieval_reset')).toEqual([
      [
        'memory.close_retrieval_reset',
        { rows: 3, status: 'ok', ms: expect.any(Number) },
        { actionId: 'act_awareness_start' },
      ],
    ])
  })
})
