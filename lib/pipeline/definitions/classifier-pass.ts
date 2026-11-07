import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { DbCtx } from '@/lib/db'

import { CLASSIFIER_HELD, isClassifierHeld, type PassInputs } from './memory-chain'
import { ensurePeriodicClassifierPipelineRegistered } from './periodic-classifier'
import { runPipeline } from '../runtime/orchestrator'
import type { RejectedStart, TxResult } from '../types'

const ALONE: PassInputs = { alone: true }

/**
 * Starts a pass unless its branch is held: the pass would re-read writes still on disk
 * (classifier.md → Failure policy). `alone` chains nothing.
 */
export async function runClassifierPass(
  ids: { storyId: string; branchId: string },
  ctx: DbCtx,
  opts?: { alone?: true },
): Promise<TxResult | RejectedStart> {
  ensurePeriodicClassifierPipelineRegistered()
  if (await isClassifierHeld(ids.branchId, ctx))
    return { outcome: 'rejected', blockedBy: CLASSIFIER_HELD }
  return runPipeline(PERIODIC_CLASSIFIER_KIND, {
    storyId: ids.storyId,
    branchId: ids.branchId,
    ...(opts?.alone ? { inputs: ALONE } : {}),
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
  })
}
