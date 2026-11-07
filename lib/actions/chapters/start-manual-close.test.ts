import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateStructured } from '@/lib/ai'
import { branches, chapters, pipelineRuns, storyEntries } from '@/lib/db'
import {
  __resetBus,
  __resetRegistry,
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  ensurePerTurnPipelineRegistered,
  PER_TURN_KIND,
  pipelineEventBus,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { currentStoryStore, generationStore, resetAllStores, type PendingClose } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, startManualClose } from './start-manual-close'
import { writeSystemEntry } from '../story-entries/system-entry'
import { registerStoreOnlyRun } from '../turns/__tests__/stand-in-pass'

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
  resetAllStores()
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

  it('refuses while an entry past the watermark is unprocessed', async () => {
    await setClassifierStatus({ state: 'idle', processedThrough: tailPosition() - 1 })

    await expectRefused(
      await startManualClose(f.branchId, lastReply(), f.ctx),
      MANUAL_CLOSE_REFUSAL.unprocessed,
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
})
