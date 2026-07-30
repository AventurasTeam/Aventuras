import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { SqlOp } from '@/lib/db'
import { awaitRunTerminal, generationStore } from '@/lib/stores'

/**
 * The two classifier-era obligations of every prose reversal, in one place
 * (generation-pipeline.md -> Prose reversals and the classifier barrier):
 * drain the in-flight classifier, and hold `reversalInProgress` across the
 * whole wait -> sweep window so no freshly-scheduled run can read pre-sweep
 * prose. Slices 3.9 / 3.10 call this, never the sweep directly.
 *
 * Not re-entrant: `reversalInProgress` is a plain boolean, so a nested
 * bracket's `finally` would drop the barrier while the outer sweep still runs.
 */
export async function bracketProseReversal<T>(body: () => Promise<T>): Promise<T> {
  if (generationStore.getTxState().reversalInProgress)
    throw new Error('bracketProseReversal is not re-entrant')
  generationStore.setReversalInProgress(true)
  try {
    await awaitRunTerminal(PERIODIC_CLASSIFIER_KIND, 'cancel')
    return await body()
  } finally {
    generationStore.setReversalInProgress(false)
  }
}

/**
 * `processedThrough <- min(processedThrough, position(B) - 1)` for `B` the
 * earliest entry the reversal removes (classifier.md -> Persistence). Returned
 * as ops so the caller splices them into the sweep's own transaction — the
 * clamp must not be able to land without the reversal, or the pass would skip
 * re-processing changed turns.
 *
 * Key-scoped `json_set`, never a read-modify-write of the whole blob
 * (cadence.md -> per-field UPDATEs): the classifier pipeline writes `state`,
 * `retryCount` and the timestamps on this same column — including on the
 * teardown of the run this bracket just aborted — so serializing a snapshot
 * read from outside the transaction would clobber them. The `WHERE` guard
 * covers both no-op cases: a NULL status or an already-low watermark makes
 * `json_extract` NULL / false and the statement matches no row.
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
