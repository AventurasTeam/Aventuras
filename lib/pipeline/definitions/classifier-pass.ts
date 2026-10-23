import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { DbCtx } from '@/lib/db'

import { CLASSIFIER_HELD, isClassifierHeld } from './memory-chain'
import { ensurePeriodicClassifierPipelineRegistered } from './periodic-classifier'
import { runPipeline } from '../runtime/orchestrator'
import type { RejectedStart, TxResult } from '../types'

/**
 * Starts a pass unless its branch is held: the pass would re-read writes still on disk
 * (classifier.md → Failure policy). `beforeTurn` marks Send's owed pass.
 */
export async function runClassifierPass(
  ids: { storyId: string; branchId: string },
  ctx: DbCtx,
  opts?: { beforeTurn?: true },
): Promise<TxResult | RejectedStart> {
  ensurePeriodicClassifierPipelineRegistered()
  if (await isClassifierHeld(ids.branchId, ctx))
    return { outcome: 'rejected', blockedBy: CLASSIFIER_HELD }
  return runPipeline(PERIODIC_CLASSIFIER_KIND, {
    storyId: ids.storyId,
    branchId: ids.branchId,
    ...(opts?.beforeTurn ? { beforeTurn: true } : {}),
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
  })
}
