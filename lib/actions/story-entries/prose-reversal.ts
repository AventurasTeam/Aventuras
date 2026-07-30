import { eq } from 'drizzle-orm'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, type DbCtx, type SqlOp } from '@/lib/db'
import { awaitRunTerminal, generationStore } from '@/lib/stores'

/**
 * The two classifier-era obligations of every prose reversal, in one place
 * (generation-pipeline.md -> Prose reversals and the classifier barrier):
 * drain the in-flight classifier, and hold `reversalInProgress` across the
 * whole wait -> sweep window so no freshly-scheduled run can read pre-sweep
 * prose. Slices 3.9 / 3.10 call this, never the sweep directly.
 */
export async function bracketProseReversal<T>(body: () => Promise<T>): Promise<T> {
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
 */
export async function classifierWatermarkClampOps(
  branchId: string,
  earliestRemovedPosition: number,
  ctx: Pick<DbCtx, 'db'>,
): Promise<SqlOp[]> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  const status = row?.classifierStatus ?? null
  if (status?.processedThrough == null) return []
  const clamped = Math.min(status.processedThrough, earliestRemovedPosition - 1)
  if (clamped >= status.processedThrough) return []
  return [
    ctx.db
      .update(branches)
      .set({ classifierStatus: { ...status, processedThrough: clamped } })
      .where(eq(branches.id, branchId))
      .toSQL(),
  ]
}
