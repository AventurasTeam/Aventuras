import type { DbCtx } from '@/lib/db'
import { runClassifierPass, type RejectedStart, type TxResult } from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

/**
 * A pass whatever the cadence count, on the open story's branch, alone: an owed close waits for
 * Send (classifier.md → Failure policy). A held branch refuses it.
 */
export async function runClassifierNow(
  branchId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return { outcome: 'rejected', blockedBy: 'branch-not-open' }
  return runClassifierPass({ storyId: open.storyId, branchId }, ctx, { alone: true })
}
