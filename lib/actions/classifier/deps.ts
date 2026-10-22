import { sql } from 'drizzle-orm'

import { branches, deltas, type DbCtx } from '@/lib/db'

/**
 * Boot resets an orphaned `running` to idle; `failed` keeps its error. A branch holding an
 * unreversed orphan's deltas stays `running`, held, until a boot reverses them: reconciling would
 * let the pass re-read a window whose partial writes are still on disk.
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
