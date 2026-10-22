import { sql } from 'drizzle-orm'

import { branches, deltas, type DbCtx } from '@/lib/db'

/**
 * Boot-time orphan reconciliation: a branch left `state: 'running'` was owned by a
 * process that no longer exists. Scoped to `$.state` and to 'running' only — a
 * 'failed' branch keeps its error for the status block.
 *
 * `unreversedActionIds` are the orphans whose boot reversal threw. A branch still holding
 * their deltas is NOT reconcilable: it keeps `running`, which suspends the cadence
 * (reconciling would let the classifier re-read a window whose partial writes are still on
 * disk), and Send and `[Run classifier now]` refuse it until a boot reverses them.
 */
export async function resetStuckClassifierRunState(
  ctx: DbCtx,
  unreversedActionIds: readonly string[],
): Promise<void> {
  // Keyed on surviving deltas, not on the failure alone: a reversal prunes what it
  // replays, so an orphan with no deltas left has nothing stranded and reconciles.
  const quarantine =
    unreversedActionIds.length === 0
      ? sql``
      : sql` AND ${branches.id} NOT IN (SELECT ${deltas.branchId} FROM ${deltas}
              WHERE ${deltas.actionId} IN (${sql.join(
                unreversedActionIds.map((id) => sql`${id}`),
                sql`, `,
              )}))`
  await ctx.db.run(
    sql`UPDATE ${branches}
        SET classifier_status = json_set(classifier_status, '$.state', 'idle')
        WHERE json_extract(classifier_status, '$.state') = 'running'${quarantine}`,
  )
}
