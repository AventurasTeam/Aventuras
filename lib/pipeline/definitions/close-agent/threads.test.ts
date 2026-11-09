import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import { USER_EDITED_SINCE_PROSE, type GroupOutcome, type GuardRow } from '@/lib/actions/types'
import { deltas, threads, type Thread } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext } from './dispatch'
import type { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { updateThreadTool } from './thread-tools'
import { assertReplaySafe, type CloseTool } from './tool'
import { CLOSE_REASON } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { __resetRegistry } from '../../authoring/registry'
import { __resetBus, pipelineEventBus } from '../../runtime/event-bus'
import { runPipeline } from '../../runtime/orchestrator'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseResult,
  PipelineEvent,
  TxResult,
} from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

const KIND = 'close-threads-test'

let f: CloseFixture

afterEach(() => {
  resetAllStores()
})

// Substitutable ids must be real uuids: CloseIds.show allocates only those.
const threadId = (n: number): string => `thr_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type SeedThread = Pick<
  Thread,
  'id' | 'title' | 'description' | 'status' | 'category' | 'icon' | 'injectionMode' | 'createdAt'
>

// THREADS_SHOWN's order is the model's: th1 LETTER, th2 SEALED, th3 FAR_BANK, th4 SECOND_MARK.
const LETTER: SeedThread = {
  id: threadId(1),
  title: 'Deliver the letter',
  description: 'Wren carries a sealed letter to the reeve of Low Ashby.',
  status: 'active',
  category: 'quest',
  icon: 'scroll',
  injectionMode: 'auto',
  createdAt: 10,
}
const SEALED: SeedThread = {
  id: threadId(2),
  title: 'The sealed letter',
  description: 'The letter must reach Low Ashby with its seal unbroken.',
  status: 'active',
  category: 'quest',
  icon: 'mail',
  injectionMode: 'auto',
  createdAt: 20,
}
const FAR_BANK: SeedThread = {
  id: threadId(3),
  title: 'The light on the far bank',
  description: 'A light moved on the far bank and went out.',
  status: 'pending',
  category: 'mystery',
  icon: 'eye',
  injectionMode: 'always',
  createdAt: 30,
}
const SECOND_MARK: SeedThread = {
  id: threadId(4),
  title: 'The second mark',
  description: 'Someone pressed a second, smaller mark beneath the seal.',
  status: 'active',
  category: 'mystery',
  icon: 'search',
  injectionMode: 'auto',
  createdAt: 40,
}
const THREADS_SHOWN: readonly SeedThread[] = [LETTER, SEALED, FAR_BANK, SECOND_MARK]
// Resolved, so the Threads start leaves it out; seedThreads doesn't write it.
const SETTLED: SeedThread = {
  id: threadId(5),
  title: 'Pay the ferryman',
  description: 'Tobin names a price for the night crossing.',
  status: 'resolved',
  category: 'errand',
  icon: 'coin',
  injectionMode: 'auto',
  createdAt: 50,
}

// The chapter runs from the opening to the third reply (positions 1-7); E is that reply.
const endEntryIdOf = (fx: CloseFixture): string => fx.entries[6]!.id
const chapterEntryIdsOf = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map(({ id }) => id)
// The fifth reply (position 11): past E, under the fixture's act_close_turn_5.
const laterReplyIdOf = (fx: CloseFixture): string => fx.replyIds[4]!

/** A pass's thread: triggered at a chapter reply, created unanchored under an action no turn owns. */
async function seedPassThread(fx: CloseFixture, thread: SeedThread, opensAt = 0): Promise<void> {
  const closed = thread.status === 'resolved' || thread.status === 'failed'
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createThread',
        source: 'periodic_classifier',
        payload: {
          entry: {
            ...thread,
            branchId: fx.branchId,
            triggeredAtEntryId: fx.replyIds[opensAt]!,
            resolvedAtEntryId: closed ? fx.replyIds[opensAt + 1]! : null,
            updatedAt: thread.createdAt,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: fx.branchId,
      entryId: null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${thread.title} refused: ${result.reason}`)
}

/**
 * The user's thread, both refs null, inserted with no delta as one written before the chapter: a
 * user_edit create logged now would read as the user's edit after every turn's prose.
 */
async function seedUsersThread(fx: CloseFixture, thread: SeedThread): Promise<void> {
  await fx.ctx.db.insert(threads).values({
    ...thread,
    branchId: fx.branchId,
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    updatedAt: thread.createdAt,
  })
  // The stores hydrated before the insert; reopening reads the row into them.
  const reopened = await loadOpenStory(fx.branchId, fx.ctx)
  if (reopened.status !== 'ok')
    throw new Error(`threads fixture: the story did not reopen: ${reopened.status}`)
}

/** THREADS_SHOWN on the fixture: three a pass wrote, each opened at its own reply, and the user's. */
async function seedThreads(fx: CloseFixture): Promise<void> {
  await seedPassThread(fx, LETTER, 0)
  await seedPassThread(fx, SEALED, 1)
  await seedPassThread(fx, FAR_BANK, 2)
  await seedUsersThread(fx, SECOND_MARK)
}

type ThreadEdit = Partial<Pick<Thread, 'title' | 'description' | 'category' | 'icon' | 'status'>>

/** A user's edit lands unanchored after every turn's prose; a later turn's anchors past E. */
async function editThreadAs(
  fx: CloseFixture,
  who: 'user' | 'later-turn',
  id: string,
  patch: ThreadEdit,
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateThread',
        source: who === 'user' ? 'user_edit' : 'per_turn_classifier',
        payload: { branchId: fx.branchId, id, patch },
      },
      actionId: who === 'user' ? 'act_user_edit' : 'act_close_turn_5',
      branchId: fx.branchId,
      entryId: who === 'user' ? null : laterReplyIdOf(fx),
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit of ${id} refused: ${result.reason}`)
}

async function threadRow(fx: CloseFixture, id: string): Promise<Thread | undefined> {
  const [row] = await fx.ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, fx.branchId), eq(threads.id, id)))
  return row
}

function runDeltas(fx: CloseFixture, actionId: string) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

type GroupEvent = Extract<PipelineEvent, { type: 'delta_group_emitted' }>
const groupEvents = (events: readonly PipelineEvent[]): GroupEvent[] =>
  events.filter((event): event is GroupEvent => event.type === 'delta_group_emitted')

type ThreadCall = { toolName: string; input: Record<string, unknown> }
type ThreadRun = {
  result: TxResult
  events: PipelineEvent[]
  /** What each call answered the model, in order. */
  answers: unknown[]
  calls: CloseLedger['calls']
  ids: CloseIds
}
type StagedRun = {
  fx: CloseFixture
  shown: readonly SeedThread[]
  calls: readonly ThreadCall[]
  answers: unknown[]
  ledger?: CloseLedger
  ids?: CloseIds
}

const THREAD_TOOLS: Readonly<Record<string, CloseTool>> = { update_thread: updateThreadTool }

let staged: StagedRun | undefined

// Stands where the Threads task will: the run's ids and ledger, its start's rows shown and read.
async function* threadCallsPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = staged
  if (run === undefined) throw new Error('threadCallsPhase: no run staged')
  const chapterEntryIds = chapterEntryIdsOf(run.fx)
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(chapterEntryIds)
  for (const { id, title } of run.shown) ids.show(id, title)
  const ledger = seedCloseLedger(phase.intermediates)
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id))
  const readSet = createReadSet()
  readSet.add(run.shown.map(({ id }): GuardRow => ({ table: 'threads', id })))
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: endEntryIdOf(run.fx),
    task: 'threads',
    part: 1,
    ids,
    readFields: { thread: ['title', 'description', 'status'] },
    survivorOf: (table, id) => writer.survivorOf(table, id),
    phase,
    chapterEntryIds,
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of run.calls.entries()) {
    const tool = THREAD_TOOLS[toolName]
    if (tool === undefined) throw new Error(`no thread tool ${toolName}`)
    const answer = yield* dispatchToolCall(
      { toolCallId: `call_${index + 1}`, toolName, input },
      tool,
      ctx,
    )
    run.answers.push(answer.output)
  }
  run.ledger = ledger
  run.ids = ids
  return { status: 'completed' }
}

/** A fresh registry and bus, the harness pipeline, and the fixture with THREADS_SHOWN seeded. */
async function openThreadsFixture(): Promise<CloseFixture> {
  __resetRegistry()
  __resetBus()
  definePipeline({
    kind: KIND,
    phases: [{ name: 'agent', run: threadCallsPhase }],
    affordance: 'invisible',
    gateBehavior: 'hard-gate',
    concurrencyPolicy: {},
  })
  const fx = await openCloseFixture()
  await seedThreads(fx)
  return fx
}

/** Runs `calls` in order through dispatch, as a Threads task whose start showed `shown`. */
async function runThreadCalls(
  fx: CloseFixture,
  shown: readonly SeedThread[],
  calls: readonly ThreadCall[],
): Promise<ThreadRun> {
  const events: PipelineEvent[] = []
  const unsubscribe = pipelineEventBus.subscribeAll((event) => {
    events.push(event)
  })
  const run: StagedRun = { fx, shown, calls, answers: [] }
  staged = run
  try {
    const result = expectRan(
      await runPipeline(KIND, {
        storyId: fx.storyId,
        branchId: fx.branchId,
        db: fx.ctx.db,
        runInTransaction: fx.ctx.runInTransaction,
      }),
    )
    if (result.outcome !== 'completed')
      throw new Error(`the run ${result.outcome}: ${JSON.stringify(result.error)}`)
    if (run.ledger === undefined || run.ids === undefined) throw new Error('the phase never ran')
    return { result, events, answers: run.answers, calls: run.ledger.calls, ids: run.ids }
  } finally {
    unsubscribe()
    staged = undefined
  }
}

const cite = (
  turns: readonly string[] = ['t7'],
  why = 'The chapter settles it at the milestone.',
): { turns: string[]; why: string } => ({ turns: [...turns], why })

describe('thread tool schemas', () => {
  it('declares schemas the SDK replays as written', () => {
    assertReplaySafe(updateThreadTool.schema, [
      {
        id: 'th1',
        description: 'Wren hands the letter over.',
        status: 'resolved',
        turns: ['t7'],
        why: 'She does.',
      },
      { id: 'th1', status: 'failed', turns: ['t5', 't7'], why: 'The seal broke.' },
    ])
  })
})

describe('update_thread', () => {
  beforeEach(async () => {
    f = await openThreadsFixture()
  })

  it("lands a description and a status as one group: chapter_close, the run's action, anchored on E", async () => {
    const description = 'Wren hands the letter to the reeve of Low Ashby.'

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th1', description, status: 'resolved', ...cite() },
      },
    ])

    expect(run.calls).toEqual([
      {
        task: 'threads',
        part: 1,
        tool: 'update_thread',
        rows: [{ table: 'threads', id: LETTER.id, name: LETTER.title }],
        why: 'The chapter settles it at the milestone.',
        turns: [endEntryIdOf(f)],
        result: 'ok',
        values: { description, status: 'resolved' },
      },
    ])
    expect(run.answers).toEqual([{ result: 'ok' }])
    expect(groupEvents(run.events).map(({ actions }) => actions.map(({ kind }) => kind))).toEqual([
      ['updateThread', 'setThreadStatus'],
    ])
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      description,
      status: 'resolved',
      triggeredAtEntryId: f.replyIds[0],
      resolvedAtEntryId: endEntryIdOf(f),
    })
    const written = await runDeltas(f, run.result.actionId)
    expect(written).toHaveLength(2)
    for (const delta of written)
      expect(delta).toMatchObject({
        source: 'chapter_close',
        actionId: run.result.actionId,
        entryId: endEntryIdOf(f),
        targetTable: 'threads',
        targetId: LETTER.id,
      })
  })

  it('writes resolved_at_entry_id as the latest cited turn by position, whatever the order cited', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th1', status: 'resolved', ...cite(['t3', 't5', 't4']) },
      },
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      turns: [f.entries[2]!.id, f.entries[3]!.id, f.entries[4]!.id],
    })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      status: 'resolved',
      resolvedAtEntryId: f.entries[4]!.id,
    })
  })

  it("writes resolved_at_entry_id at the thread's opening when the cited turn precedes it", async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th3', status: 'resolved', ...cite(['t4']) } },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok', turns: [f.entries[3]!.id] })
    expect(await threadRow(f, FAR_BANK.id)).toMatchObject({
      status: 'resolved',
      triggeredAtEntryId: f.replyIds[2],
      resolvedAtEntryId: f.replyIds[2],
    })
  })

  it("writes resolved_at_entry_id at the cited turn when it follows the thread's opening", async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th2', status: 'resolved', ...cite(['t7']) } },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(await threadRow(f, SEALED.id)).toMatchObject({
      triggeredAtEntryId: f.replyIds[1],
      resolvedAtEntryId: endEntryIdOf(f),
    })
  })

  it("keeps both refs of the user's thread null when it fails it", async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th4', status: 'failed', ...cite() } },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok', values: { status: 'failed' } })
    expect(await threadRow(f, SECOND_MARK.id)).toMatchObject({
      status: 'failed',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
    })
  })

  it('refuses a call whose only field is blank, or that sends none, writing nothing', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th1', description: '   ', ...cite() } },
      { toolName: 'update_thread', input: { id: 'th1', ...cite() } },
    ])

    expect(run.calls.map(({ result, reason }) => [result, reason])).toEqual([
      ['rejected', expect.stringContaining('nothing to write')],
      ['rejected', expect.stringContaining('nothing to write')],
    ])
    for (const call of run.calls) expect(call).not.toHaveProperty('values')
    expect(groupEvents(run.events)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await threadRow(f, LETTER.id)).toMatchObject({ description: LETTER.description })
  })

  it('stores an over-bound description cut to 1,200 characters, the report holding the same text', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th1', description: 'x'.repeat(1_500), ...cite() },
      },
    ])

    expect((await threadRow(f, LETTER.id))?.description).toBe('x'.repeat(1_200))
    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      values: { description: 'x'.repeat(1_200) },
    })
  })

  it('skips a description a later turn wrote, landing the status beside it', async () => {
    await editThreadAs(f, 'later-turn', LETTER.id, {
      description: 'Wren hides the letter in her boot.',
    })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: {
          id: 'th1',
          description: 'Wren hands the letter over.',
          status: 'resolved',
          ...cite(),
        },
      },
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      values: { description: 'Wren hands the letter over.', status: 'resolved' },
      skippedFields: [{ field: 'description', reason: CLOSE_REASON.laterTurn }],
    })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      description: 'Wren hides the letter in her boot.',
      status: 'resolved',
    })
    expect(await runDeltas(f, run.result.actionId)).toHaveLength(1)
  })

  it('skips a status a later turn wrote, landing the description beside it', async () => {
    await editThreadAs(f, 'later-turn', LETTER.id, { status: 'failed' })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: {
          id: 'th1',
          description: 'Wren hands the letter over.',
          status: 'resolved',
          ...cite(),
        },
      },
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'status', reason: CLOSE_REASON.laterTurn }],
    })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      description: 'Wren hands the letter over.',
      status: 'failed',
    })
    expect(await runDeltas(f, run.result.actionId)).toHaveLength(1)
  })

  it('leaves a restated description out of the report beside a status that lands', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th1', description: LETTER.description, status: 'resolved', ...cite() },
      },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]?.values).toEqual({ status: 'resolved' })
  })

  it('answers ok, emitting no group, for a status and a description the thread already holds', async () => {
    await seedPassThread(f, SETTLED)

    const run = await runThreadCalls(
      f,
      [...THREADS_SHOWN, SETTLED],
      [
        {
          toolName: 'update_thread',
          input: { id: 'th5', description: SETTLED.description, status: 'resolved', ...cite() },
        },
      ],
    )

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]).not.toHaveProperty('values')
    expect(run.calls[0]).not.toHaveProperty('skippedFields')
    expect(groupEvents(run.events)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it("reads the user's over-bound description resent whole as restated: ok, not skipped or cut", async () => {
    const long = 'y'.repeat(1_500)
    await editThreadAs(f, 'user', LETTER.id, { description: long })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th1', description: long, ...cite() } },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]).not.toHaveProperty('values')
    expect(groupEvents(run.events)).toEqual([])
    expect((await threadRow(f, LETTER.id))?.description).toBe(long)
  })

  it('reads a description the thread holds at its bound as restated when resent over it', async () => {
    await editThreadAs(f, 'user', LETTER.id, { description: 'x'.repeat(1_200) })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th1', description: 'x'.repeat(1_500), ...cite() },
      },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]).not.toHaveProperty('values')
    expect(groupEvents(run.events)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('skips a status the user wrote after the cited turn, landing the description: ok naming status', async () => {
    await editThreadAs(f, 'user', LETTER.id, { status: 'failed' })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: {
          id: 'th1',
          description: 'Wren hands the letter over.',
          status: 'resolved',
          ...cite(),
        },
      },
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      values: { description: 'Wren hands the letter over.', status: 'resolved' },
      skippedFields: [{ field: 'status', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      description: 'Wren hands the letter over.',
      status: 'failed',
    })
  })

  it('skips a description the user wrote after the cited turn, landing the status', async () => {
    await editThreadAs(f, 'user', LETTER.id, { description: 'Wren means to read it first.' })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: {
          id: 'th1',
          description: 'Wren hands the letter over.',
          status: 'resolved',
          ...cite(),
        },
      },
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'description', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      description: 'Wren means to read it first.',
      status: 'resolved',
    })
  })

  it('refuses a thread that is gone as row-gone, keeping the status it proposed', async () => {
    const gone: SeedThread = { ...SETTLED, id: threadId(9), title: "The ferryman's debt" }

    const run = await runThreadCalls(
      f,
      [...THREADS_SHOWN, gone],
      [{ toolName: 'update_thread', input: { id: 'th5', status: 'failed', ...cite() } }],
    )

    expect(run.calls[0]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      rows: [{ table: 'threads', id: gone.id, name: gone.title }],
      values: { status: 'failed' },
    })
    expect(run.answers[0]).toMatchObject({ result: 'rejected', reason: CLOSE_REASON.rowGone })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })
})
