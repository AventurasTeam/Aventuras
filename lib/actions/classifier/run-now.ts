import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { DbCtx } from '@/lib/db'
import {
  CLASSIFIER_HELD,
  ensurePeriodicClassifierPipelineRegistered,
  isClassifierHeld,
  runPipeline,
  type RejectedStart,
  type RunCtx,
  type TxResult,
} from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

/**
 * `[Run classifier now]`: a pass whatever the cadence count. Refuses a branch held `running`,
 * whose unreversed writes a pass would re-read (classifier.md → Failure policy).
 */
export async function runClassifierNow(
  branchId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return { outcome: 'rejected', blockedBy: 'branch-not-open' }
  if (await isClassifierHeld(branchId, ctx))
    return { outcome: 'rejected', blockedBy: CLASSIFIER_HELD }
  ensurePeriodicClassifierPipelineRegistered()
  const runCtx: RunCtx = { storyId: open.storyId, branchId, ...ctx }
  return runPipeline(PERIODIC_CLASSIFIER_KIND, runCtx)
}
