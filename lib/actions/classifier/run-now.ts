import type { DbCtx } from '@/lib/db'
import { EMBEDDER_SWAP_REFUSAL, isStorySwapPending } from '@/lib/embedder-swap'
import { runClassifierPass, type RejectedStart, type TxResult } from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

import { BRANCH_NOT_OPEN } from '../refusal-codes'

/**
 * A pass whatever the cadence count, on the open story's branch, alone: an owed close waits for
 * Send (classifier.md → Failure policy). A held branch refuses it, and so does a pending embedder
 * swap, as it refuses a close: reconcile would decide by name alone, with no vectors to compare.
 */
export async function runClassifierNow(
  branchId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return { outcome: 'rejected', blockedBy: BRANCH_NOT_OPEN }
  if (isStorySwapPending(open.storyId))
    return { outcome: 'rejected', blockedBy: EMBEDDER_SWAP_REFUSAL }
  return runClassifierPass({ storyId: open.storyId, branchId }, ctx, { alone: true })
}
