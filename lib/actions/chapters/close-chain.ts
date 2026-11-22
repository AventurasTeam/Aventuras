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
import {
  currentStoryStore,
  generationStore,
  isStoryBusy,
  type OpenStory,
  type PendingTurn,
} from '@/lib/stores'

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

/** The caller's own pending mark on the branch, as `bracketPendingTurn` hands its body. */
export type OwnPendingMark = { readonly mark: PendingTurn; readonly end: () => void }

type CloseChainOpts = {
  /** Runs after the held check, before the unprocessed count; a refusal ends the start. */
  validate?: () => Promise<RejectedStart | null>
  /** Runs in the synchronous section before the reserve; a failure starts nothing. */
  preflight?: (open: OpenStory) => ConfigResolverError | null
  /** Fires at the reserve, after `pendingMark` ends. */
  onReserved?: () => void
  /** The busy check skips this mark alone, and the reserve ends it. */
  pendingMark?: OwnPendingMark
}

// A variable takes no excess-property check, so only an explicit `undefined` keeps out a
// pre-flight.
type UnpreflightedOpts = Omit<CloseChainOpts, 'preflight'> & { preflight?: undefined }

/**
 * Starts the pass while entries are unprocessed (under a pending re-run, counted through its
 * chapter's end only), else the close; resolves with the chain's end, the refusal, or a pre-flight
 * failure. Rejects when the origin or pre-flight throws, as `startChain` does: a caller must
 * handle it.
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
  const tx = generationStore.getTxState()
  if (isStoryBusy(tx, open.storyId, branchId, { ownMark: opts?.pendingMark?.mark }))
    return refused(MANUAL_CLOSE_REFUSAL.busy)
  if (generationStore.getSettleCount() !== settled) return refused(MANUAL_CLOSE_REFUSAL.busy)
  const failed = opts?.preflight?.(open)
  if (failed) return { outcome: 'preflight-failed', error: failed }
  const kind = unprocessed ? PERIODIC_CLASSIFIER_KIND : CHAPTER_CLOSE_KIND
  const ran = await startChain(kind, {
    storyId: open.storyId,
    branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    onReserved: () => {
      opts?.pendingMark?.end()
      opts?.onReserved?.()
    },
  })
  return 'outcome' in ran ? ran : ran.end
}
