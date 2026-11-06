import { canEndChapter } from '@/lib/chapters'
import { openRegionSeries } from '@/lib/db'
import { isStorySwapPending } from '@/lib/embedder-swap'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  ensureChapterClosePipelineRegistered,
  isClassifierHeld,
  readClassifierStatus,
  runPipeline,
  unprocessedEntryCount,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { currentStoryStore, generationStore, isStoryBusy } from '@/lib/stores'

import type { DbCtx } from '../types'

/**
 * `RejectedStart.blockedBy` for a manual close refused before it runs. A held branch reads
 * `CLASSIFIER_HELD`; a start the orchestrator rejects reads the kind that blocked it.
 */
export const MANUAL_CLOSE_REFUSAL = {
  branchNotOpen: 'branch-not-open',
  invalidEnd: 'invalid-end',
  unprocessed: 'unprocessed-entries',
  swapPending: 'embedder-swap',
  busy: 'story-busy',
} as const

export type ManualCloseRefusal = (typeof MANUAL_CLOSE_REFUSAL)[keyof typeof MANUAL_CLOSE_REFUSAL]

const refused = (blockedBy: ManualCloseRefusal | typeof CLASSIFIER_HELD): RejectedStart => ({
  outcome: 'rejected',
  blockedBy,
})

/**
 * chapter-close.md → Manual user-triggered close, ending on `endEntryId`. C14: it starts only where
 * a close can run at once, and writes `pendingClose` only once the run has reserved.
 */
export async function startManualClose(
  branchId: string,
  endEntryId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart> {
  if (currentStoryStore.getCurrentStory()?.branchId !== branchId)
    return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  ensureChapterClosePipelineRegistered()
  if (await isClassifierHeld(branchId, ctx)) return refused(CLASSIFIER_HELD)
  // C10: the series holds no system or stamped row, and canEndChapter is the only kind rule.
  const end = (await openRegionSeries(branchId, ctx)).find((row) => row.id === endEntryId)
  if (!end || !canEndChapter(end)) return refused(MANUAL_CLOSE_REFUSAL.invalidEnd)
  const { processedThrough } = await readClassifierStatus(branchId, ctx)
  if ((await unprocessedEntryCount(branchId, processedThrough, ctx)) > 0)
    return refused(MANUAL_CLOSE_REFUSAL.unprocessed)

  // No await from here to the reserve, so no swap or run can start in between.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refused(MANUAL_CLOSE_REFUSAL.swapPending)
  if (isStoryBusy(generationStore.getTxState(), open.storyId, branchId))
    return refused(MANUAL_CLOSE_REFUSAL.busy)
  return runPipeline(CHAPTER_CLOSE_KIND, {
    storyId: open.storyId,
    branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    // Fires only on reserve: a start the orchestrator rejects leaves the record as it stood.
    onReserved: () => generationStore.setPendingClose(branchId, { endEntryId }),
  })
}
