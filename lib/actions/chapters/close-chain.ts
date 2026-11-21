import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { isStorySwapPending, EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  ensureChapterClosePipelineRegistered,
  ensurePeriodicClassifierPipelineRegistered,
  isClassifierHeld,
  readClassifierStatus,
  startChain,
  unprocessedEntryCount,
  unprocessedThroughChapter,
  type ChainEnd,
  type ConfigResolverError,
  type PreflightFailedStart,
  type RejectedStart,
} from '@/lib/pipeline'
import { currentStoryStore, generationStore, isStoryBusy, type OpenStory } from '@/lib/stores'

import { BRANCH_NOT_OPEN } from '../refusal-codes'
import type { DbCtx } from '../types'

/**
 * `RejectedStart.blockedBy` for a close chain refused before it runs. A held branch reads
 * `CLASSIFIER_HELD`; a start the orchestrator rejects reads the kind that blocked it.
 */
export const MANUAL_CLOSE_REFUSAL = {
  branchNotOpen: BRANCH_NOT_OPEN,
  invalidEnd: 'invalid-end',
  swapPending: EMBEDDER_SWAP_REFUSAL,
  busy: 'story-busy',
} as const

export type ManualCloseRefusal = (typeof MANUAL_CLOSE_REFUSAL)[keyof typeof MANUAL_CLOSE_REFUSAL]

export const refused = (blockedBy: ManualCloseRefusal | typeof CLASSIFIER_HELD): RejectedStart => ({
  outcome: 'rejected',
  blockedBy,
})

type CloseChainOpts = {
  /** Runs after the held check, before the unprocessed count; a refusal ends the start. */
  validate?: () => Promise<RejectedStart | null>
  /** Runs in the synchronous section before the reserve; a failure starts nothing. */
  preflight?: (open: OpenStory) => ConfigResolverError | null
  onReserved?: () => void
  /** The caller holds a pending mark on this branch, which `onReserved` releases. */
  ownsPendingMark?: true
}

// A variable takes no excess-property check, so only an explicit `undefined` keeps a pre-flight out.
type UnpreflightedOpts = Omit<CloseChainOpts, 'preflight'> & { preflight?: undefined }

/**
 * Starts the pass (entries unprocessed; under a pending re-run, only those through its chapter's
 * end) or the close; resolves with the chain's end, the refusal, or, given a pre-flight, its
 * failure. Rejects when the origin or the pre-flight throws, as
 * `startChain` does: a caller must handle it.
 */
export function startCloseChain(
  branchId: string,
  ctx: DbCtx,
  opts?: UnpreflightedOpts,
): Promise<ChainEnd | RejectedStart>
export function startCloseChain(
  branchId: string,
  ctx: DbCtx,
  opts: CloseChainOpts,
): Promise<ChainEnd | RejectedStart | PreflightFailedStart>
export async function startCloseChain(
  branchId: string,
  ctx: DbCtx,
  opts?: CloseChainOpts,
): Promise<ChainEnd | RejectedStart | PreflightFailedStart> {
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
  // A re-run catches up through its chapter's end only (generation-pipeline.md → chainsTo on
  // predecessor).
  const rerun = generationStore.getTxState().pendingRerun.get(branchId)
  const unprocessed =
    (rerun
      ? await unprocessedThroughChapter(branchId, rerun.chapterId, processedThrough, ctx)
      : await unprocessedEntryCount(branchId, processedThrough, ctx)) > 0

  // No await from here to the reserve, so no swap or run can start in between.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refused(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refused(MANUAL_CLOSE_REFUSAL.swapPending)
  const busy = isStoryBusy(
    generationStore.getTxState(),
    open.storyId,
    branchId,
    opts?.ownsPendingMark ? { ignorePendingTurns: true } : undefined,
  )
  if (busy) return refused(MANUAL_CLOSE_REFUSAL.busy)
  if (generationStore.getSettleCount() !== settled) return refused(MANUAL_CLOSE_REFUSAL.busy)
  const failed = opts?.preflight?.(open)
  if (failed) return { outcome: 'preflight-failed', error: failed }
  const kind = unprocessed ? PERIODIC_CLASSIFIER_KIND : CHAPTER_CLOSE_KIND
  const ran = await startChain(kind, {
    storyId: open.storyId,
    branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    onReserved: opts?.onReserved,
  })
  return 'outcome' in ran ? ran : ran.end
}
