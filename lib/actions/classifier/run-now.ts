import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { DbCtx } from '@/lib/db'
import {
  ensurePeriodicClassifierPipelineRegistered,
  runPipeline,
  type RunCtx,
} from '@/lib/pipeline'
import { currentStoryStore } from '@/lib/stores'

/**
 * `[Run classifier now]`. Also the failed-persistent escape hatch: it starts
 * regardless of the cadence count and the suspension.
 */
export async function runClassifierNow(branchId: string, ctx: DbCtx) {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId)
    return { outcome: 'rejected' as const, blockedBy: 'branch-not-open' }
  ensurePeriodicClassifierPipelineRegistered()
  const runCtx: RunCtx = { storyId: open.storyId, branchId, ...ctx }
  return runPipeline(PERIODIC_CLASSIFIER_KIND, runCtx)
}
