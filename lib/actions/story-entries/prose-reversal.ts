import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { SqlOp } from '@/lib/db'
import { awaitRunTerminal, generationStore } from '@/lib/stores'

import { settleUserWrites } from '../delta/apply-delta-action'
import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from '../delta/branch-write-lock'

// One id serves every bracket: the barrier flag already admits one at a time.
const PROSE_REVERSAL_LOCK_ID = 'prose-reversal'

/**
 * generation-pipeline.md -> Prose reversals and the classifier barrier. Not re-entrant: a
 * nested bracket's `finally` would drop the barrier while the outer sweep still runs.
 */
export async function bracketProseReversal<T>(
  branchId: string,
  body: () => Promise<T>,
): Promise<T> {
  if (generationStore.getTxState().reversalInProgress)
    throw new Error('bracketProseReversal is not re-entrant')
  generationStore.setReversalInProgress(true)
  try {
    await awaitRunTerminal(PERIODIC_CLASSIFIER_KIND, branchId, 'cancel')
    await settleUserWrites()
    // Exclusive, so the reversal can't commit between a rollback preview's closure reads.
    await holdBranchWriteExclusive(branchId, PROSE_REVERSAL_LOCK_ID)
    try {
      return await body()
    } finally {
      releaseBranchWriteExclusive(branchId, PROSE_REVERSAL_LOCK_ID)
    }
  } finally {
    generationStore.setReversalInProgress(false)
  }
}

/**
 * `processedThrough <- min(processedThrough, position(B) - 1)` for `B` the
 * earliest entry the reversal removes (classifier.md -> Persistence). Returned as
 * ops so the caller splices them into the sweep's own transaction: the clamp must
 * not land without the reversal, or the pass would skip re-processing changed turns.
 *
 * Key-scoped `json_set` because the classifier pipeline concurrently writes the
 * lifecycle keys on this same column; a whole-blob write would clobber them.
 */
export function classifierWatermarkClampOps(
  branchId: string,
  earliestRemovedPosition: number,
): SqlOp[] {
  const clamped = earliestRemovedPosition - 1
  return [
    {
      sql: `UPDATE branches SET classifier_status = json_set(classifier_status, '$.processedThrough', ?) WHERE id = ? AND json_extract(classifier_status, '$.processedThrough') > ?`,
      params: [clamped, branchId, clamped],
    },
  ]
}
