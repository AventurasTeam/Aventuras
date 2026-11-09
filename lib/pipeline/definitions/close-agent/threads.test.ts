import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import { USER_EDITED_SINCE_PROSE, type GroupOutcome, type GuardRow } from '@/lib/actions/types'
import { generateToolStep, type ResolveModelConfig, type ToolStepResult } from '@/lib/ai'
import {
  branches,
  deltas,
  entities,
  stories,
  storyEntries,
  threads,
  type StoryMode,
  type Thread,
  type ThreadStatus,
} from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext } from './dispatch'
import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { __setCloseAgentSlots } from './slots'
import type { TaskPromptContext } from './task'
import { mergeThreadsTool, updateThreadTool } from './thread-tools'
import { THREADS_READ_FIELDS, threadsTask } from './threads'
import { assertReplaySafe, DELETE_PATH, type CloseTool } from './tool'
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
import { closeAgentPhase } from '../chapter-close-agent'
import { closeIdsOf, seedCloseLedger, setCloseRange } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

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

const THREAD_TOOLS: Readonly<Record<string, CloseTool>> = {
  update_thread: updateThreadTool,
  merge_threads: mergeThreadsTool,
}

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
    assertReplaySafe(mergeThreadsTool.schema, [
      { keep: 'th1', absorb: ['th2'], turns: ['t7'], why: 'One errand.' },
      {
        keep: 'th1',
        absorb: ['th2', 'th3'],
        title: 'Deliver the sealed letter',
        description: 'Wren must bring the letter to Low Ashby unread.',
        turns: ['t5', 't7'],
        why: 'The same errand, twice.',
      },
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

  // triggered_at_entry_id has no foreign key, so a copied thread can name an entry another branch holds.
  it("keeps the cited turn when the thread's opening entry is on another branch, past it", async () => {
    await f.ctx.db
      .insert(branches)
      .values({ id: 'br_other', storyId: f.storyId, name: 'Other', createdAt: 0 })
    await f.ctx.db.insert(storyEntries).values({
      id: 'entry_only_on_other_branch',
      branchId: 'br_other',
      position: 99,
      kind: 'user_action',
      content: 'Elsewhere.',
      createdAt: 99,
    })
    await f.ctx.db
      .update(threads)
      .set({ triggeredAtEntryId: 'entry_only_on_other_branch' })
      .where(eq(threads.id, LETTER.id))

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      { toolName: 'update_thread', input: { id: 'th1', status: 'resolved', ...cite(['t4']) } },
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      status: 'resolved',
      resolvedAtEntryId: f.entries[3]!.id,
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

describe('merge_threads', () => {
  beforeEach(async () => {
    f = await openThreadsFixture()
  })

  const merge = (input: Record<string, unknown>): ThreadCall => ({
    toolName: 'merge_threads',
    input: { ...input, ...cite(['t7'], 'The two threads are one errand.') },
  })
  const opsOf = (written: Awaited<ReturnType<typeof runDeltas>>) =>
    written.map(({ op, targetId }) => [op, targetId])

  it('refuses keep inside absorb, a repeated id and an empty absorb, writing nothing', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th1', 'th2'] }),
      merge({ keep: 'th1', absorb: ['th2', 'th2'] }),
      merge({ keep: 'th1', absorb: [] }),
    ])

    expect(run.calls.map(({ result, reason }) => [result, reason])).toEqual([
      ['rejected', expect.stringContaining('keep is also in absorb')],
      ['rejected', expect.stringContaining('absorb names a thread twice')],
      ['rejected', expect.stringContaining('absorb is empty')],
    ])
    const letterRow = { table: 'threads', id: LETTER.id, name: LETTER.title }
    const sealedRow = { table: 'threads', id: SEALED.id, name: SEALED.title }
    expect(run.calls.map(({ rows }) => rows)).toEqual([
      [letterRow, sealedRow],
      [letterRow, sealedRow],
      [letterRow],
    ])
    for (const call of run.calls) expect(call).not.toHaveProperty('survivor')
    expect(groupEvents(run.events)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await threadRow(f, SEALED.id)).toBeDefined()
  })

  it('lands a clean merge as one update of keep and a delete of each absorbed thread, in one group', async () => {
    const title = 'Deliver the sealed letter'
    const description = 'Wren must bring the letter to the reeve of Low Ashby with its seal whole.'

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2', 'th3'], title, description }),
    ])

    expect(run.calls).toEqual([
      {
        task: 'threads',
        part: 1,
        tool: 'merge_threads',
        rows: [
          { table: 'threads', id: LETTER.id, name: LETTER.title },
          { table: 'threads', id: SEALED.id, name: SEALED.title },
          { table: 'threads', id: FAR_BANK.id, name: FAR_BANK.title },
        ],
        why: 'The two threads are one errand.',
        turns: [endEntryIdOf(f)],
        result: 'ok',
        values: { title, description },
        survivor: { table: 'threads', id: LETTER.id },
      },
    ])
    expect(run.answers).toEqual([{ result: 'ok', survivor: 'th1' }])
    expect(groupEvents(run.events).map(({ actions }) => actions.map(({ kind }) => kind))).toEqual([
      ['updateThread', 'deleteThread', 'deleteThread'],
    ])
    expect(await threadRow(f, LETTER.id)).toMatchObject({ title, description })
    expect(await threadRow(f, SEALED.id)).toBeUndefined()
    expect(await threadRow(f, FAR_BANK.id)).toBeUndefined()
    const written = await runDeltas(f, run.result.actionId)
    expect(opsOf(written)).toEqual([
      ['update', LETTER.id],
      ['delete', SEALED.id],
      ['delete', FAR_BANK.id],
    ])
    for (const delta of written)
      expect(delta).toMatchObject({
        source: 'chapter_close',
        actionId: run.result.actionId,
        entryId: endEntryIdOf(f),
      })
  })

  it('stores an over-bound title cut to 120 characters, the report holding the same text', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'], title: 'L'.repeat(200) }),
    ])

    expect((await threadRow(f, LETTER.id))?.title).toBe('L'.repeat(120))
    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]!.values).toEqual({ title: 'L'.repeat(120) })
  })

  it.each<[string, Record<string, unknown>]>([
    ['no text', {}],
    ['only the text keep holds', { title: LETTER.title, description: LETTER.description }],
  ])(
    'lands a redundant merge with %s as the delete alone, keep untouched',
    async (_label, text) => {
      const run = await runThreadCalls(f, THREADS_SHOWN, [
        merge({ keep: 'th1', absorb: ['th2'], ...text }),
      ])

      expect(run.calls[0]).toMatchObject({
        result: 'ok',
        survivor: { table: 'threads', id: LETTER.id },
      })
      expect(run.calls[0]).not.toHaveProperty('values')
      expect(groupEvents(run.events).map(({ actions }) => actions.map(({ kind }) => kind))).toEqual(
        [['deleteThread']],
      )
      expect(await threadRow(f, LETTER.id)).toMatchObject({
        title: LETTER.title,
        description: LETTER.description,
      })
      expect(await threadRow(f, SEALED.id)).toBeUndefined()
    },
  )

  it.each<[string, SeedThread, ThreadEdit]>([
    ['a field of keep it leaves alone', LETTER, { category: 'errand' }],
    ['the absorbed thread', SEALED, { description: 'Wren breaks the seal at the milestone.' }],
  ])(
    'skips a merge whole when a later turn wrote %s, writing nothing',
    async (_label, thread, patch) => {
      await editThreadAs(f, 'later-turn', thread.id, patch)

      const run = await runThreadCalls(f, THREADS_SHOWN, [
        merge({ keep: 'th1', absorb: ['th2'], title: 'Deliver the sealed letter' }),
      ])

      expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
      expect(run.calls[0]!.values).toEqual({ title: 'Deliver the sealed letter' })
      expect(run.calls[0]).not.toHaveProperty('skippedFields')
      expect(run.calls[0]).not.toHaveProperty('survivor')
      expect(JSON.stringify(run.calls)).not.toContain(DELETE_PATH)
      expect(groupEvents(run.events)).toEqual([])
      expect(await runDeltas(f, run.result.actionId)).toEqual([])
      expect(await threadRow(f, SEALED.id)).toBeDefined()
    },
  )

  it('skips a redundant merge whole, not ok, when the user edited any field of an absorbed thread', async () => {
    await editThreadAs(f, 'user', SEALED.id, { icon: 'feather' })

    const run = await runThreadCalls(f, THREADS_SHOWN, [merge({ keep: 'th1', absorb: ['th2'] })])

    expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(run.calls[0]).not.toHaveProperty('skippedFields')
    expect(run.answers[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await threadRow(f, SEALED.id)).toBeDefined()
  })

  it("records only the text keep doesn't hold when a user's edit skips the merge", async () => {
    await editThreadAs(f, 'user', SEALED.id, { icon: 'feather' })
    const description = 'Wren must bring the letter to Low Ashby with its seal whole.'

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'], title: LETTER.title, description }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(run.calls[0]!.values).toEqual({ description })
  })

  it("skips a merge as a later turn's when one row has a later turn's write and another the user's edit", async () => {
    await editThreadAs(f, 'later-turn', LETTER.id, { category: 'errand' })
    await editThreadAs(f, 'user', SEALED.id, { icon: 'feather' })

    const run = await runThreadCalls(f, THREADS_SHOWN, [merge({ keep: 'th1', absorb: ['th2'] })])

    expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    expect(await threadRow(f, SEALED.id)).toBeDefined()
  })

  it('skips a merge whole when the user wrote, after the cited turn, a field it writes on keep', async () => {
    await editThreadAs(f, 'user', LETTER.id, { title: "The reeve's letter" })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'], title: 'Deliver the sealed letter' }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await threadRow(f, LETTER.id)).toMatchObject({ title: "The reeve's letter" })
    expect(await threadRow(f, SEALED.id)).toBeDefined()
  })

  it("lands a merge when the user edited only fields of keep it doesn't write", async () => {
    await editThreadAs(f, 'user', LETTER.id, {
      category: 'errand',
      description: "The user's note on the letter.",
    })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'], title: 'Deliver the sealed letter' }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]!.values).toEqual({ title: 'Deliver the sealed letter' })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      title: 'Deliver the sealed letter',
      description: "The user's note on the letter.",
      category: 'errand',
    })
    expect(await threadRow(f, SEALED.id)).toBeUndefined()
  })

  it('lands a merge that resends the title the user gave keep: nothing to write there, so nothing to protect', async () => {
    await editThreadAs(f, 'user', LETTER.id, { title: "The reeve's letter" })

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'], title: "The reeve's letter" }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(run.calls[0]).not.toHaveProperty('values')
    expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([['delete', SEALED.id]])
  })

  it('refuses absorbing a thread this close already wrote, saying to keep it instead', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th2', description: 'The seal is cracked but holds.', ...cite() },
      },
      merge({ keep: 'th1', absorb: ['th2'] }),
    ])

    expect(run.calls.map(({ result }) => result)).toEqual(['ok', 'rejected'])
    expect(run.calls[1]!.reason).toContain('keep that thread instead')
    expect(run.calls[1]).not.toHaveProperty('survivor')
    expect(await threadRow(f, SEALED.id)).toMatchObject({
      description: 'The seal is cracked but holds.',
    })
    expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([['update', SEALED.id]])
  })

  it('names the absorbed thread this close wrote in the answer only, the ledger keeping its reason', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th2', description: 'The seal is cracked but holds.', ...cite() },
      },
      merge({ keep: 'th1', absorb: ['th3', 'th2'] }),
    ])

    expect(run.calls[1]).toMatchObject({
      result: 'rejected',
      reason:
        'this close already wrote a thread in absorb, and absorbing it would block undoing the close: keep that thread instead',
    })
    expect(JSON.stringify(run.calls[1])).not.toContain('th2')
    expect(run.answers[1]).toMatchObject({
      result: 'rejected',
      note: expect.stringContaining('th2'),
    })
    expect(JSON.stringify(run.answers[1])).not.toContain('th3')
  })

  it.each<[string, SeedThread, string, string[]]>([
    ['neither as keep', SECOND_MARK, 'th4', ['th1', 'th2']],
    ['one as keep', LETTER, 'th1', ['th2', 'th4']],
  ])(
    'refuses a merge of two threads this close wrote, %s, as one that cannot land in this close',
    async (_label, kept, keep, absorb) => {
      const description = 'Wren must bring the letter to Low Ashby with its seal whole.'
      const run = await runThreadCalls(f, THREADS_SHOWN, [
        {
          toolName: 'update_thread',
          input: { id: 'th2', description: 'The seal is cracked but holds.', ...cite() },
        },
        {
          toolName: 'update_thread',
          input: { id: 'th1', description: 'Wren hides the letter in her boot.', ...cite() },
        },
        merge({ keep, absorb, title: kept.title, description }),
      ])

      expect(run.calls[2]).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('cannot be merged in this close'),
      })
      expect(run.calls[2]!.values).toEqual({ description })
      expect(run.answers[2]).not.toHaveProperty('note')
      expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([
        ['update', SEALED.id],
        ['update', LETTER.id],
      ])
    },
  )

  it('refuses as unmergeable, with no note, when keeping the written thread would drop an active one', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th3', description: 'The light moves again, closer to the ford.', ...cite() },
      },
      merge({ keep: 'th1', absorb: ['th3'] }),
    ])

    expect(run.calls[1]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('cannot be merged in this close'),
    })
    expect(run.answers[1]).not.toHaveProperty('note')
    expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([['update', FAR_BANK.id]])
  })

  it.each(['resolved', 'failed'] as const)(
    'refuses as unmergeable, with no note, when keeping the thread this close %s would drop an active one',
    async (status) => {
      const run = await runThreadCalls(f, THREADS_SHOWN, [
        { toolName: 'update_thread', input: { id: 'th2', status, ...cite() } },
        merge({ keep: 'th1', absorb: ['th2'] }),
      ])

      expect(run.calls[1]).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('cannot be merged in this close'),
      })
      expect(run.answers[1]).not.toHaveProperty('note')
      expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([['update', SEALED.id]])
    },
  )

  it.each(['resolved', 'failed'] as const)(
    'answers a merge into a thread this close %s as unmergeable, not as one to swap',
    async (status) => {
      const run = await runThreadCalls(f, THREADS_SHOWN, [
        { toolName: 'update_thread', input: { id: 'th2', status, ...cite() } },
        merge({ keep: 'th2', absorb: ['th1'] }),
      ])

      expect(run.calls[1]).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('cannot be merged in this close'),
      })
      expect(run.answers[1]).not.toHaveProperty('note')
      expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([['update', SEALED.id]])
    },
  )

  it('lands the advice to a refusal: keep the active thread, then settle it', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th3', absorb: ['th1'] }),
      merge({ keep: 'th1', absorb: ['th3'] }),
      { toolName: 'update_thread', input: { id: 'th1', status: 'resolved', ...cite() } },
    ])

    expect(run.calls.map(({ result }) => result)).toEqual(['rejected', 'ok', 'ok'])
    expect(await threadRow(f, FAR_BANK.id)).toBeUndefined()
    expect(await threadRow(f, LETTER.id)).toMatchObject({ status: 'resolved' })
  })

  it("records only the text keep doesn't hold when the close's own write refuses the merge", async () => {
    const description = 'Wren must bring the letter to Low Ashby with its seal whole.'

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th2', description: 'The seal is cracked but holds.', ...cite() },
      },
      merge({ keep: 'th1', absorb: ['th2'], title: LETTER.title, description }),
    ])

    expect(run.calls[1]).toMatchObject({ result: 'rejected' })
    expect(run.calls[1]!.values).toEqual({ description })
  })

  it('lands a merge that keeps the thread this close already wrote', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      {
        toolName: 'update_thread',
        input: { id: 'th2', description: 'The seal is cracked but holds.', ...cite() },
      },
      merge({ keep: 'th2', absorb: ['th1'] }),
    ])

    expect(run.calls.map(({ result }) => result)).toEqual(['ok', 'ok'])
    expect(run.calls[1]).toMatchObject({ survivor: { table: 'threads', id: SEALED.id } })
    expect(await threadRow(f, LETTER.id)).toBeUndefined()
    expect(opsOf(await runDeltas(f, run.result.actionId))).toEqual([
      ['update', SEALED.id],
      ['delete', LETTER.id],
    ])
  })

  it('refuses absorbing an active thread into a pending one, saying to keep the active one', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th3', absorb: ['th1'], title: 'The light and the letter' }),
    ])

    expect(run.calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('keep an active one'),
    })
    expect(run.calls[0]!.values).toEqual({ title: 'The light and the letter' })
    expect(run.calls[0]).not.toHaveProperty('survivor')
    expect(groupEvents(run.events)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    expect(await threadRow(f, LETTER.id)).toBeDefined()
  })

  it('refuses a pending keep absorbing an active thread beside a settled one', async () => {
    await seedPassThread(f, SETTLED, 3)

    const run = await runThreadCalls(
      f,
      [...THREADS_SHOWN, SETTLED],
      [merge({ keep: 'th3', absorb: ['th1', 'th5'] })],
    )

    expect(run.calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('keep an active one'),
    })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it.each(['resolved', 'failed'] as const)(
    'refuses a %s keep absorbing an active thread, saying to keep an active one and settle it after',
    async (status) => {
      const kept: SeedThread = { ...SETTLED, status }
      await seedPassThread(f, kept, 3)

      const run = await runThreadCalls(
        f,
        [...THREADS_SHOWN, kept],
        [merge({ keep: 'th5', absorb: ['th1'] })],
      )

      expect(run.calls[0]).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('keep an active one'),
      })
      expect(run.calls[0]!.reason).toContain('settle it with update_thread')
      expect(run.calls[0]).not.toHaveProperty('survivor')
      expect(await runDeltas(f, run.result.actionId)).toEqual([])
      expect(await threadRow(f, LETTER.id)).toMatchObject({ status: 'active' })
      expect(await threadRow(f, SETTLED.id)).toMatchObject({ status })
    },
  )

  it("records only the text keep doesn't hold when an active thread can't join a pending one", async () => {
    const description = 'A light on the far bank, and the letter Wren carries past it.'

    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th3', absorb: ['th1'], title: FAR_BANK.title, description }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'rejected' })
    expect(run.calls[0]!.values).toEqual({ description })
  })

  it("lands the reverse, keep's status, refs, category, icon and injection mode standing", async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({
        keep: 'th1',
        absorb: ['th3'],
        description: 'Wren carries the letter east while a light watches from the far bank.',
      }),
    ])

    expect(run.calls[0]).toMatchObject({ result: 'ok' })
    expect(await threadRow(f, LETTER.id)).toMatchObject({
      status: 'active',
      triggeredAtEntryId: f.replyIds[0],
      resolvedAtEntryId: null,
      category: 'quest',
      icon: 'scroll',
      injectionMode: 'auto',
    })
    expect(await threadRow(f, FAR_BANK.id)).toBeUndefined()
  })

  it('refuses a later write to a thread a merge absorbed, naming the kept thread to the model only', async () => {
    const run = await runThreadCalls(f, THREADS_SHOWN, [
      merge({ keep: 'th1', absorb: ['th2'] }),
      { toolName: 'update_thread', input: { id: 'th2', status: 'resolved', ...cite() } },
      merge({ keep: 'th3', absorb: ['th2'] }),
    ])

    expect(run.calls.map(({ result, reason }) => [result, reason])).toEqual([
      ['ok', undefined],
      ['rejected', CLOSE_REASON.rowGone],
      ['rejected', CLOSE_REASON.rowGone],
    ])
    expect(run.calls[1]).not.toHaveProperty('survivor')
    expect(run.calls[2]).not.toHaveProperty('survivor')
    expect(run.answers[1]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      survivor: 'th1',
    })
    expect(run.answers[2]).toMatchObject({ result: 'rejected', survivor: 'th1' })
  })
})

// Real prefix_<uuid> ids. echo sorts before heir: the two share a createdAt.
const OPEN_ROWS = {
  debt: 'thr_00000000-0000-4000-8000-00000000c010',
  letter: 'thr_00000000-0000-4000-8000-00000000c020',
  echo: 'thr_00000000-0000-4000-8000-00000000c030',
  heir: 'thr_00000000-0000-4000-8000-00000000c031',
  map: 'thr_00000000-0000-4000-8000-00000000c040',
  abbey: 'thr_00000000-0000-4000-8000-00000000c041',
  kael: 'char_00000000-0000-4000-8000-00000000c050',
} as const

type ThreadRowSeed = {
  id: string
  title: string
  status: ThreadStatus
  createdAt: number
  description?: string | null
  /** A user's thread keeps both refs null (data-model.md → Authorship contract). */
  byUser?: boolean
}

async function putThreadRow(fx: CloseFixture, row: ThreadRowSeed): Promise<void> {
  const closed = row.status === 'resolved' || row.status === 'failed'
  const sourceTurn = row.byUser ? null : fx.entries[1]!.id
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createThread',
        source: row.byUser ? 'user_edit' : 'periodic_classifier',
        payload: {
          entry: {
            id: row.id,
            branchId: fx.branchId,
            title: row.title,
            description: row.description ?? null,
            status: row.status,
            injectionMode: 'auto',
            triggeredAtEntryId: sourceTurn,
            resolvedAtEntryId: closed && !row.byUser ? fx.entries[3]!.id : null,
            createdAt: row.createdAt,
            updatedAt: row.createdAt,
          },
        },
      },
      actionId: `act_seed_${row.id}`,
      branchId: fx.branchId,
      entryId: sourceTurn,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${row.title} refused: ${result.reason}`)
}

// Two of each open status, the user's among them, and one resolved and one failed.
async function putThreadRoster(fx: CloseFixture): Promise<void> {
  await putThreadRow(fx, {
    id: OPEN_ROWS.heir,
    title: 'Find the heir',
    status: 'active',
    createdAt: 30,
    description: 'Still open.',
  })
  await putThreadRow(fx, {
    id: OPEN_ROWS.map,
    title: 'The lost map',
    status: 'resolved',
    createdAt: 5,
  })
  await putThreadRow(fx, {
    id: OPEN_ROWS.debt,
    title: 'The debt to the guild',
    status: 'pending',
    createdAt: 10,
    description: 'Owed since the spring.',
  })
  await putThreadRow(fx, {
    id: OPEN_ROWS.abbey,
    title: 'Warn the abbey',
    status: 'failed',
    createdAt: 6,
  })
  await putThreadRow(fx, {
    id: OPEN_ROWS.letter,
    title: 'Deliver the letter',
    status: 'active',
    createdAt: 20,
    byUser: true,
  })
  await putThreadRow(fx, {
    id: OPEN_ROWS.echo,
    title: 'Echoes on the river',
    status: 'pending',
    createdAt: 30,
    description: 'Someone answers from the far bank.',
  })
}

// A character in one turn's scene, so Identity has a start beside Threads'.
async function putSceneCharacter(fx: CloseFixture, id: string, name: string, entryId: string) {
  await fx.ctx.db.insert(entities).values({
    id,
    branchId: fx.branchId,
    kind: 'character',
    name,
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`putSceneCharacter: entry ${entryId} has no metadata`)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [id] } })
    .where(where)
}

// As the agent phase does before any task: every chapter entry a turn, t1 the first.
function threadsIdsWithTurns(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(fx.entries.map((entry) => entry.id))
  return ids
}

const THREADS_START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

function threadsPromptContext(fx: CloseFixture, ids: CloseIds): TaskPromptContext {
  const actionId = 'act_threads_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries.at(-1)!.id,
    task: 'threads',
    part: 1,
    ids,
    readFields: THREADS_READ_FIELDS,
    survivorOf: () => undefined,
    phase: {
      actionId,
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    chapterEntryIds: fx.entries.map((entry) => entry.id),
    config: THREADS_START_CONFIG,
  }
}

describe('threadsTask', () => {
  async function startOf(fx: CloseFixture, ids = threadsIdsWithTurns(fx)) {
    const ctx = threadsPromptContext(fx, ids)
    return { ctx, ids, start: await threadsTask.start(ctx) }
  }

  it("lists canon's tools in order and reads a thread's title, description and status", () => {
    expect(threadsTask.task).toBe('threads')
    expect(threadsTask.tools.map((tool) => tool.name)).toEqual([
      'read_row',
      'update_thread',
      'merge_threads',
    ])
    expect(THREADS_READ_FIELDS).toEqual({ thread: ['title', 'description', 'status'] })
    expect(threadsTask.readFields).toBe(THREADS_READ_FIELDS)
  })

  it("starts from every pending and active thread, the user's included, oldest first", async () => {
    const fx = await openCloseFixture()
    await putThreadRoster(fx)

    const { ids, start } = await startOf(fx)

    expect(start?.show.threads).toEqual([
      {
        id: 'th1',
        title: 'The debt to the guild',
        description: 'Owed since the spring.',
        status: 'pending',
      },
      { id: 'th2', title: 'Deliver the letter', description: '', status: 'active' },
      {
        id: 'th3',
        title: 'Echoes on the river',
        description: 'Someone answers from the far bank.',
        status: 'pending',
      },
      { id: 'th4', title: 'Find the heir', description: 'Still open.', status: 'active' },
    ])
    expect(ids.handleOf(OPEN_ROWS.map)).toBeUndefined()
    expect(ids.handleOf(OPEN_ROWS.abbey)).toBeUndefined()
  })

  it('seeds every shown thread as read, and no other', async () => {
    const fx = await openCloseFixture()
    await putThreadRoster(fx)

    const { start } = await startOf(fx)

    expect(start?.seeds).toEqual([
      { table: 'threads', id: OPEN_ROWS.debt },
      { table: 'threads', id: OPEN_ROWS.letter },
      { table: 'threads', id: OPEN_ROWS.echo },
      { table: 'threads', id: OPEN_ROWS.heir },
    ])
  })

  it('returns null when no thread is pending or active', async () => {
    const fx = await openCloseFixture()
    expect((await startOf(fx)).start).toBeNull()

    await putThreadRow(fx, {
      id: OPEN_ROWS.map,
      title: 'The lost map',
      status: 'resolved',
      createdAt: 5,
    })
    await putThreadRow(fx, {
      id: OPEN_ROWS.abbey,
      title: 'Warn the abbey',
      status: 'failed',
      createdAt: 6,
    })
    const { ids, start } = await startOf(fx)

    expect(start).toBeNull()
    expect(ids.handleOf(OPEN_ROWS.map)).toBeUndefined()
  })

  it("names every shown thread's id and title in the user half, then the writes so far", async () => {
    const fx = await openCloseFixture()
    await putThreadRoster(fx)
    const { ctx, start } = await startOf(fx)
    const writes = '- update_character Kael (c1): state.traits'

    const { system, user } = threadsTask.render(start!, { ...ctx, writesSoFar: writes })

    expect(user).toContain(
      '## th1: The debt to the guild (pending)\n- description: "Owed since the spring."',
    )
    expect(user).toContain('## th2: Deliver the letter (active)\n- description: ""')
    expect(user).toContain('## th3: Echoes on the river (pending)\n')
    expect(user).toContain('## th4: Find the heir (active)\n- description: "Still open."')
    expect(user).not.toContain('The lost map')
    expect(user).not.toContain('Warn the abbey')
    expect(
      user.endsWith(`# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`),
    ).toBe(true)
    expect(system).not.toContain('# Open threads')
  })

  // memory/chapter-close.md → Conversations: a part's tasks reuse the chapter's cached prefix.
  it("renders a system half byte-identical to Identity's for the same turns and mode", async () => {
    const fx = await openCloseFixture()
    await putSceneCharacter(fx, OPEN_ROWS.kael, 'Kael', fx.entries[2]!.id)
    await putThreadRow(fx, {
      id: OPEN_ROWS.heir,
      title: 'Find the heir',
      status: 'active',
      createdAt: 30,
      description: 'Still open.',
    })
    const ctx = threadsPromptContext(fx, threadsIdsWithTurns(fx))
    const identityStart = await identityTask.start({
      ...ctx,
      task: 'identity',
      readFields: IDENTITY_READ_FIELDS,
    })
    const threadsStart = await threadsTask.start(ctx)

    const identityPrompt = identityTask.render(identityStart!, { ...ctx, writesSoFar: '' })
    const threadsPrompt = threadsTask.render(threadsStart!, { ...ctx, writesSoFar: '' })

    expect(threadsPrompt.system).toBe(identityPrompt.system)
    expect(threadsPrompt.system).toContain(
      '## t3 (narration)\nThe inn is warm and loud with drovers.',
    )
    expect(threadsPrompt.user).not.toBe(identityPrompt.user)
  })

  // Forks share thread ids under (branch_id, id): the start keeps to the close's branch.
  it("reads only the close's branch, where a fork holds the same ids", async () => {
    const fx = await openCloseFixture()
    const forkId = 'br_close_fork'
    await fx.ctx.db.insert(branches).values({
      id: forkId,
      storyId: fx.storyId,
      parentBranchId: fx.branchId,
      name: 'fork',
      createdAt: 2,
    })
    await putThreadRow(fx, {
      id: OPEN_ROWS.heir,
      title: 'Find the heir',
      status: 'active',
      createdAt: 30,
      description: 'Main.',
    })
    const base = {
      injectionMode: 'auto' as const,
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
      updatedAt: 1,
    }
    await fx.ctx.db.insert(threads).values({
      ...base,
      id: OPEN_ROWS.heir,
      branchId: forkId,
      title: 'Find the heir',
      description: 'Fork.',
      status: 'active',
      createdAt: 30,
    })
    await fx.ctx.db.insert(threads).values({
      ...base,
      id: OPEN_ROWS.debt,
      branchId: forkId,
      title: 'Fork only',
      status: 'pending',
      createdAt: 1,
    })

    const { ids, start } = await startOf(fx)

    expect(start?.show.threads).toEqual([
      { id: 'th1', title: 'Find the heir', description: 'Main.', status: 'active' },
    ])
    expect(start?.seeds).toEqual([{ table: 'threads', id: OPEN_ROWS.heir }])
    expect(ids.handleOf(OPEN_ROWS.debt)).toBeUndefined()
  })

  it('returns null, allocating no handle, when the task has no turns', async () => {
    const fx = await openCloseFixture()
    await putThreadRoster(fx)
    const ids = threadsIdsWithTurns(fx)
    const ctx = { ...threadsPromptContext(fx, ids), chapterEntryIds: [] }

    expect(await threadsTask.start(ctx)).toBeNull()
    expect(ids.handleOf(OPEN_ROWS.debt)).toBeUndefined()
  })

  it("puts the story mode's rule in the system half, the same as Identity's", async () => {
    const fx = await openCloseFixture()
    await putSceneCharacter(fx, OPEN_ROWS.kael, 'Kael', fx.entries[2]!.id)
    await putThreadRoster(fx)
    const render = async (mode: StoryMode) => {
      const [story] = await fx.ctx.db
        .select({ definition: stories.definition })
        .from(stories)
        .where(eq(stories.id, fx.storyId))
      await fx.ctx.db
        .update(stories)
        .set({ definition: { ...story!.definition!, mode } })
        .where(eq(stories.id, fx.storyId))
      const ctx = threadsPromptContext(fx, threadsIdsWithTurns(fx))
      const identityStart = await identityTask.start({
        ...ctx,
        task: 'identity',
        readFields: IDENTITY_READ_FIELDS,
      })
      const threadsStart = await threadsTask.start(ctx)
      return {
        identity: identityTask.render(identityStart!, { ...ctx, writesSoFar: '' }).system,
        threads: threadsTask.render(threadsStart!, { ...ctx, writesSoFar: '' }).system,
      }
    }

    const creative = await render('creative')
    expect(creative.threads).toContain('Each is a direction or prose')
    expect(creative.threads).not.toContain('Each is what the lead does, says or attempts')
    expect(creative.threads).toBe(creative.identity)

    const adventure = await render('adventure')
    expect(adventure.threads).toContain('Each is what the lead does, says or attempts')
    expect(adventure.threads).not.toContain('Each is a direction or prose')
    expect(adventure.threads).toBe(adventure.identity)
  })

  it('refuses to render with no turns', async () => {
    const fx = await openCloseFixture()
    await putThreadRoster(fx)
    const { ctx, start } = await startOf(fx)

    expect(() =>
      threadsTask.render(
        { ...start!, show: { ...start!.show, closeTurns: [] } },
        { ...ctx, writesSoFar: '' },
      ),
    ).toThrow('at least one turn')
  })
})

function threadsNoCallStep(): ToolStepResult {
  return {
    status: 'ok',
    step: {
      calls: [],
      invalidCalls: [],
      responseMessages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Nothing to change.' }] },
      ],
      text: 'Nothing to change.',
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokens: 5,
        outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
        totalTokens: 105,
      },
    },
    recoverable: [],
  }
}

// The opening through the third reply (positions 1-7): one part.
function threadsClosePhase(fx: CloseFixture): PhaseContext {
  const actionId = 'act_threads_close'
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, {
    chapterId: 'chap_threads_close',
    startEntryId: fx.entries[0]!.id,
    endEntryId: fx.replyIds[2]!,
  })
  return {
    actionId,
    abortSignal: new AbortController().signal,
    intermediates,
    log: makeLogger(actionId),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

async function drainThreadsAgent(
  ctx: PhaseContext,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next(undefined)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

describe('Threads in the production close', () => {
  let fx: CloseFixture
  const starts = [
    { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 7 },
    { type: 'close_task_start', task: 'threads', part: 1, index: 4, total: 7 },
  ]
  const startsIn = (events: readonly PhaseEmittedEvent[]) =>
    events.filter((event) => event.type === 'close_task_start')

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(threadsNoCallStep())
    __setCloseAgentSlots(undefined)
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it("sends canon's Threads tools, starting 4 of 7, on a chapter with an open thread", async () => {
    await putThreadRow(fx, {
      id: OPEN_ROWS.heir,
      title: 'Find the heir',
      status: 'active',
      createdAt: 30,
      description: 'Still open.',
    })

    const { events, result } = await drainThreadsAgent(threadsClosePhase(fx))

    expect(result).toEqual({ status: 'completed' })
    expect(startsIn(events)).toEqual(starts)
    expect(generateToolStep).toHaveBeenCalledTimes(1)
    const [, request] = vi.mocked(generateToolStep).mock.calls[0]!
    expect(Object.keys(request.tools)).toEqual(['read_row', 'update_thread', 'merge_threads'])
    expect(request.prompt.user).toContain('## th1: Find the heir (active)')
  })

  it('makes no step call when every thread is resolved or failed', async () => {
    await putThreadRow(fx, {
      id: OPEN_ROWS.map,
      title: 'The lost map',
      status: 'resolved',
      createdAt: 5,
    })
    await putThreadRow(fx, {
      id: OPEN_ROWS.abbey,
      title: 'Warn the abbey',
      status: 'failed',
      createdAt: 6,
    })

    const { events, result } = await drainThreadsAgent(threadsClosePhase(fx))

    expect(result).toEqual({ status: 'completed' })
    expect(startsIn(events)).toEqual(starts)
    expect(generateToolStep).not.toHaveBeenCalled()
  })
})
