import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateStructured } from '@/lib/ai'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, chapters, pipelineRuns, storyEntries } from '@/lib/db'
import {
  __resetBus,
  __resetRegistry,
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  ensurePerTurnPipelineRegistered,
  isClassifierHeld,
  PER_TURN_KIND,
  pipelineEventBus,
  startPipeline,
  type PipelineEvent,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import {
  currentStoryStore,
  generationStore,
  interruptMemoryRuns,
  type PendingClose,
} from '@/lib/stores'

import { startCloseChain } from './close-chain'
import { MANUAL_CLOSE_REFUSAL, startManualClose } from './start-manual-close'
import { writeSystemEntry } from '../story-entries/system-entry'
import {
  failReversalsOf,
  registerStandInPass,
  registerStoreOnlyRun,
} from '../turns/__tests__/stand-in-pass'
import { submitTurn } from '../turns/submit-turn'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

let f: CloseFixture

beforeEach(async () => {
  vi.resetAllMocks()
  __resetRegistry()
  __resetBus()
  vi.mocked(generateStructured).mockResolvedValue(metadataReplyResult())
  f = await openCloseFixture()
})

afterEach(() => {
  resetSingletons()
})

const lastReply = (): string => f.replyIds.at(-1)!
const tailPosition = (): number => f.entries.at(-1)!.position

function closeRuns(): number {
  return [...generationStore.getTxState().runs.values()].filter(
    (r) => r.kind === CHAPTER_CLOSE_KIND,
  ).length
}

async function expectRefused(
  result: TxResult | RejectedStart,
  blockedBy: string,
  record?: PendingClose,
): Promise<void> {
  expect(result).toEqual({ outcome: 'rejected', blockedBy })
  expect(closeRuns()).toBe(0)
  expect(await f.ctx.db.select().from(pipelineRuns)).toEqual([])
  expect(await f.ctx.db.select().from(chapters)).toEqual([])
  expect(generateStructured).not.toHaveBeenCalled()
  expect(generationStore.getTxState().pendingClose.get(f.branchId)).toEqual(record)
}

async function setClassifierStatus(status: {
  state: 'idle' | 'running'
  processedThrough: number
}): Promise<void> {
  await f.ctx.db
    .update(branches)
    .set({ classifierStatus: { lastSuccessAt: null, lastError: null, ...status } })
    .where(eq(branches.id, f.branchId))
}

// A turn on the close's own story; ended by resetAllStores.
function holdStoryWithTurn(): void {
  generationStore.startRun({
    runId: 'run_same_story',
    kind: PER_TURN_KIND,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_same_story',
    storyId: f.storyId,
    branchId: f.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

type RunComplete = Extract<PipelineEvent, { type: 'run_complete' }>

function recordCompletes(): RunComplete[] {
  const seen: RunComplete[] = []
  pipelineEventBus.subscribe('run_complete', (event) => seen.push(event))
  return seen
}

const pickOn = (): PendingClose | undefined =>
  generationStore.getTxState().pendingClose.get(f.branchId)

// Fails in 2 s instead of at the test timeout: a chain that never reaches its hold would hang.
function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within 2 s`)), 2_000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

// The open region's last entry is left past the watermark, so the start owes a pass first.
async function leaveTheTailUnprocessed(): Promise<void> {
  await setClassifierStatus({ state: 'idle', processedThrough: tailPosition() - 1 })
}

describe('startManualClose refusals', () => {
  it('refuses a branch that is not the open story’s', async () => {
    await expectRefused(
      await startManualClose('br_elsewhere', lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.branchNotOpen,
    )
    currentStoryStore.__reset()
    await expectRefused(
      await startManualClose(f.branchId, lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.branchNotOpen,
    )
  })

  it('refuses a branch the open story left while the checks awaited', async () => {
    const pending = startManualClose(f.branchId, lastReply(), f.ctx)
    currentStoryStore.__reset()

    await expectRefused(await pending, MANUAL_CLOSE_REFUSAL.branchNotOpen)
  })

  it('refuses when the open story moves to another branch while the checks awaited', async () => {
    const pending = startManualClose(f.branchId, lastReply(), f.ctx)
    currentStoryStore.set({ ...currentStoryStore.getCurrentStory()!, branchId: 'br_elsewhere' })

    await expectRefused(await pending, MANUAL_CLOSE_REFUSAL.branchNotOpen)
  })

  it('refuses a swap that began while the checks awaited', async () => {
    const pending = startManualClose(f.branchId, lastReply(), f.ctx)
    const open = currentStoryStore.getCurrentStory()!
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, embedding_swap_target: 'other-embedder' },
    })

    await expectRefused(await pending, MANUAL_CLOSE_REFUSAL.swapPending)
  })

  it('refuses a branch held by a pass left running', async () => {
    await setClassifierStatus({ state: 'running', processedThrough: tailPosition() })

    await expectRefused(await startManualClose(f.branchId, lastReply(), f.ctx), CLASSIFIER_HELD)
  })

  it.each([
    ['a user_action', 'user_action'],
    ['the opening', 'opening'],
  ] as const)('refuses %s as the end, through canEndChapter', async (_label, kind) => {
    const end = f.entries.find((e) => e.kind === kind)!

    await expectRefused(
      await startManualClose(f.branchId, end.id, f.ctx),
      MANUAL_CLOSE_REFUSAL.invalidEnd,
    )
  })

  it('refuses a system entry as the end: the open region leaves it out', async () => {
    const systemId = await writeSystemEntry(
      { branchId: f.branchId, content: 'The classifier could not reach its model.' },
      f.ctx,
    )

    await expectRefused(
      await startManualClose(f.branchId, systemId, f.ctx),
      MANUAL_CLOSE_REFUSAL.invalidEnd,
    )
  })

  it('refuses a reply a chapter already holds, and one that is not there', async () => {
    await f.ctx.db
      .update(storyEntries)
      .set({ chapterId: 'chap_elsewhere' })
      .where(eq(storyEntries.id, f.replyIds[0]!))

    await expectRefused(
      await startManualClose(f.branchId, f.replyIds[0]!, f.ctx),
      MANUAL_CLOSE_REFUSAL.invalidEnd,
    )
    await expectRefused(
      await startManualClose(f.branchId, 'entry_missing', f.ctx),
      MANUAL_CLOSE_REFUSAL.invalidEnd,
    )
  })

  it('refuses a held branch before reading the end', async () => {
    await setClassifierStatus({ state: 'running', processedThrough: tailPosition() })
    const opening = f.entries.find((e) => e.kind === 'opening')!

    await expectRefused(await startManualClose(f.branchId, opening.id, f.ctx), CLASSIFIER_HELD)
  })

  // The turn's user_action commits before its run, so it reads as unprocessed: busy, not a pass.
  it('refuses a start while a turn is in flight, its user_action unprocessed', async () => {
    ensurePerTurnPipelineRegistered()
    await f.ctx.db.insert(storyEntries).values({
      id: 'entry_close_in_flight',
      branchId: f.branchId,
      position: tailPosition() + 1,
      kind: 'user_action',
      content: 'I ask the guard his name.',
      createdAt: 1,
    })
    holdStoryWithTurn()

    await expectRefused(
      await startManualClose(f.branchId, lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.busy,
    )
  })

  it('refuses during an embedder swap', async () => {
    const open = currentStoryStore.getCurrentStory()!
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, embedding_swap_target: 'other-embedder' },
    })

    await expectRefused(
      await startManualClose(f.branchId, lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.swapPending,
    )
  })

  it('refuses while a run holds the story', async () => {
    ensurePerTurnPipelineRegistered()
    holdStoryWithTurn()

    await expectRefused(
      await startManualClose(f.branchId, lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.busy,
    )
  })

  // isStoryBusy passes: the run is another story's. The orchestrator refuses, as per-turn blocks a
  // close anywhere, and the record stays what stood before.
  it('keeps the record a start the orchestrator rejects', async () => {
    ensurePerTurnPipelineRegistered()
    registerStoreOnlyRun(PER_TURN_KIND, 'br_elsewhere')
    generationStore.setPendingClose(f.branchId, { endEntryId: f.replyIds[0]! })

    await expectRefused(await startManualClose(f.branchId, lastReply(), f.ctx), 'per-turn', {
      endEntryId: f.replyIds[0]!,
    })
  })
})

describe('startManualClose starts', () => {
  it('writes the record as the close reserves and clears it at commit', async () => {
    let seen: PendingClose | undefined
    pipelineEventBus.subscribe('phase_start', (event) => {
      if (event.name === 'boundary')
        seen = generationStore.getTxState().pendingClose.get(f.branchId)
    })

    const result = await startManualClose(f.branchId, lastReply(), f.ctx)

    expect(result.outcome).toBe('completed')
    expect(seen).toEqual({ endEntryId: lastReply() })
    expect(generationStore.getTxState().pendingClose.has(f.branchId)).toBe(false)
    const rows = await f.ctx.db.select().from(chapters)
    expect(rows.map((r) => r.endEntryId)).toEqual([lastReply()])
  })

  it('leaves the record when the close fails', async () => {
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'failed',
      error: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
      recoverable: [],
    })

    const result = await startManualClose(f.branchId, lastReply(), f.ctx)

    expect(result.outcome).toBe('failed')
    expect(generationStore.getTxState().pendingClose.get(f.branchId)).toEqual({
      endEntryId: lastReply(),
    })
  })

  it('takes a system row past the watermark as nothing left to process', async () => {
    await writeSystemEntry(
      { branchId: f.branchId, content: 'The classifier could not reach its model.' },
      f.ctx,
    )

    expect((await startManualClose(f.branchId, lastReply(), f.ctx)).outcome).toBe('completed')
  })

  // The tail has no await: the first start reserves before the second reads the story as free.
  it('starts one of two closes begun together and refuses the other as busy', async () => {
    const results = await Promise.all([
      startManualClose(f.branchId, f.replyIds[2]!, f.ctx),
      startManualClose(f.branchId, f.replyIds[5]!, f.ctx),
    ])

    expect(results.map((r) => (r.outcome === 'rejected' ? r.blockedBy : r.outcome)).sort()).toEqual(
      ['completed', 'story-busy'],
    )
    expect(generateStructured).toHaveBeenCalledTimes(1)
    expect(await f.ctx.db.select().from(chapters)).toHaveLength(1)
  })

  it('runs a pass first while entries are unprocessed, then closes at the pick', async () => {
    const pass = registerStandInPass({ anchorEntryId: null })
    await leaveTheTailUnprocessed()
    const end = f.replyIds[2]!
    const completes = recordCompletes()

    const started = startManualClose(f.branchId, end, f.ctx)
    const held = await within(pass.nextHeld(), 'the catch-up pass')
    expect(pickOn()).toEqual({ endEntryId: end })
    expect(closeRuns()).toBe(0)
    held.finish('completed')
    const result = await within(started, 'the close chain')

    expect(completes.map((e) => e.kind)).toEqual([PERIODIC_CLASSIFIER_KIND, CHAPTER_CLOSE_KIND])
    const close = completes[1]!
    expect(close.actionId).not.toBe(held.actionId)
    expect(result).toEqual({ runId: close.runId, actionId: close.actionId, outcome: 'completed' })
    expect((await f.ctx.db.select().from(chapters)).map((r) => r.endEntryId)).toEqual([end])
    expect(pickOn()).toBeUndefined()
    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it('overwrites the pick a failed close left with the next one', async () => {
    vi.mocked(generateStructured).mockResolvedValueOnce({
      status: 'failed',
      error: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
      recoverable: [],
    })
    expect((await startManualClose(f.branchId, f.replyIds[1]!, f.ctx)).outcome).toBe('failed')
    expect(pickOn()).toEqual({ endEntryId: f.replyIds[1] })

    const result = await startManualClose(f.branchId, f.replyIds[3]!, f.ctx)

    expect(result.outcome).toBe('completed')
    expect((await f.ctx.db.select().from(chapters)).map((r) => r.endEntryId)).toEqual([
      f.replyIds[3],
    ])
  })

  it('keeps the pick for its close when a Send arrives while the start’s pass runs', async () => {
    const pass = registerStandInPass({ anchorEntryId: null })
    await leaveTheTailUnprocessed()
    const end = f.replyIds[2]!
    const started = startManualClose(f.branchId, end, f.ctx)
    const held = await within(pass.nextHeld(), 'the catch-up pass')

    const sent = await within(
      submitTurn(
        { storyId: f.storyId, branchId: f.branchId },
        { content: 'I wait at the milestone.', composerMode: 'free' },
        f.ctx,
      ),
      'the Send',
    )

    expect(sent).toMatchObject({ outcome: 'rejected' })
    expect(
      await f.ctx.db
        .select()
        .from(storyEntries)
        .where(eq(storyEntries.content, 'I wait at the milestone.')),
    ).toEqual([])
    expect(pickOn()).toEqual({ endEntryId: end })
    held.finish('completed')
    expect((await within(started, 'the close chain')).outcome).toBe('completed')
    expect((await f.ctx.db.select().from(chapters)).map((r) => r.endEntryId)).toEqual([end])
  })

  it('resolves failed with the close’s result when the pass commits and the close fails', async () => {
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'failed',
      error: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
      recoverable: [],
    })
    const pass = registerStandInPass({ anchorEntryId: null })
    await leaveTheTailUnprocessed()
    const completes = recordCompletes()

    const started = startManualClose(f.branchId, f.replyIds[2]!, f.ctx)
    const held = await within(pass.nextHeld(), 'the catch-up pass')
    held.finish('completed')
    const result = await within(started, 'the close chain')

    expect(completes.map((e) => [e.kind, e.outcome])).toEqual([
      [PERIODIC_CLASSIFIER_KIND, 'completed'],
      [CHAPTER_CLOSE_KIND, 'failed'],
    ])
    const close = completes[1]!
    expect(result).toEqual({
      runId: close.runId,
      actionId: close.actionId,
      outcome: 'failed',
      error: close.error,
    })
    expect(pickOn()).toEqual({ endEntryId: f.replyIds[2] })
    expect(await f.ctx.db.select().from(chapters)).toEqual([])
  })
})

describe('startCloseChain', () => {
  // The held read saw the pass live; it ends held (its reversal never commits) before the tail.
  it('refuses as busy when a pass ends held while the start reads', async () => {
    const pass = registerStandInPass({ anchorEntryId: null, statusLifecycle: true })
    failReversalsOf(pass)
    const running = startPipeline(PERIODIC_CLASSIFIER_KIND, {
      storyId: f.storyId,
      branchId: f.branchId,
      db: f.ctx.db,
      runInTransaction: f.ctx.runInTransaction,
    })
    await within(pass.nextHeld(), 'the pass')
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })

    const start = startCloseChain(f.branchId, f.ctx, {
      validate: async () => {
        entered()
        await released
        return null
      },
    })
    await within(reading, 'the start’s read')
    await interruptMemoryRuns(f.branchId)
    // Nothing else can refuse: no run is left, and the branch is held only on disk.
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(await isClassifierHeld(f.branchId, f.ctx)).toBe(true)
    release()

    expect(await within(start, 'the start')).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.busy,
    })
    expect(closeRuns()).toBe(0)
    expect(await f.ctx.db.select().from(chapters)).toEqual([])
    expect(generateStructured).not.toHaveBeenCalled()
    expect(await running.origin).toMatchObject({ outcome: 'failed' })
  })
})
