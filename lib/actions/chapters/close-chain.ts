import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { isStorySwapPending } from '@/lib/embedder-swap'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  ensureChapterClosePipelineRegistered,
  ensurePeriodicClassifierPipelineRegistered,
  isClassifierHeld,
  readClassifierStatus,
  startPipeline,
  unprocessedEntryCount,
  type ChainEnd,
  type RejectedStart,
} from '@/lib/pipeline'
import { currentStoryStore, generationStore, isStoryBusy } from '@/lib/stores'

import type { DbCtx } from '../types'

/**
 * `RejectedStart.blockedBy` for a close chain refused before it runs. A held branch reads
 * `CLASSIFIER_HELD`; a start the orchestrator rejects reads the kind that blocked it.
 */
export const MANUAL_CLOSE_REFUSAL = {
  branchNotOpen: 'branch-not-open',
  invalidEnd: 'invalid-end',
  swapPending: 'embedder-swap',
  busy: 'story-busy',
} as const

export type ManualCloseRefusal = (typeof MANUAL_CLOSE_REFUSAL)[keyof typeof MANUAL_CLOSE_REFUSAL]

const refused = (blockedBy: ManualCloseRefusal | typeof CLASSIFIER_HELD): RejectedStart => ({
  outcome: 'rejected',
  blockedBy,
})

/**
 * Starts the pass (entries unprocessed) or the close; resolves with the chain's end or the refusal.
 * Rejects when the origin throws, as `PipelineStart.origin` does: a caller must handle it.
 */
export async function startCloseChain(
  branchId: string,
  ctx: DbCtx,
  opts?: {
    /** Runs after the held check, before the unprocessed count; a refusal ends the start. */
    validate?: () => Promise<RejectedStart | null>
    onReserved?: () => void
  },
): Promise<ChainEnd | RejectedStart> {
  if (currentStoryStore.getCurrentStory()?.branchId !== branchId)
    return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  ensurePeriodicClassifierPipelineRegistered()
  ensureChapterClosePipelineRegistered()
  // A run settling during the reads below (a pass ending held, a turn committing) makes them stale.
  const settled = generationStore.getSettleCount()
  if (await isClassifierHeld(branchId, ctx)) return refused(CLASSIFIER_HELD)
  const invalid = await opts?.validate?.()
  if (invalid) return invalid
  const { processedThrough } = await readClassifierStatus(branchId, ctx)
  const unprocessed = (await unprocessedEntryCount(branchId, processedThrough, ctx)) > 0

  // No await from here to the reserve, so no swap or run can start in between.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refused(MANUAL_CLOSE_REFUSAL.swapPending)
  if (isStoryBusy(generationStore.getTxState(), open.storyId, branchId))
    return refused(MANUAL_CLOSE_REFUSAL.busy)
  if (generationStore.getSettleCount() !== settled) return refused(MANUAL_CLOSE_REFUSAL.busy)
  const kind = unprocessed ? PERIODIC_CLASSIFIER_KIND : CHAPTER_CLOSE_KIND
  const { origin, chain } = startPipeline(kind, {
    storyId: open.storyId,
    branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    onReserved: opts?.onReserved,
  })
  const first = await origin
  if (first.outcome === 'rejected') return first
  const end = await chain
  // `chain` is null only for a refused or thrown origin, both handled above.
  if (end == null) throw new Error('startCloseChain: a chain whose origin ran resolved no end')
  return end
}
