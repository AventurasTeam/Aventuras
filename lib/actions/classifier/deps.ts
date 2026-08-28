import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { idleStatus } from '@/lib/classifier'
import { branches, deltas, storyEntries, type ClassifierStatus, type DbCtx } from '@/lib/db'

/**
 * Classifiable turns past the watermark — the cadence's input. Counts rows rather
 * than differencing positions: `system` entries occupy positions but are filtered
 * out of the window, so a position delta fires the cadence early on a branch that
 * carries technical rows.
 */
export async function unprocessedTurnCount(
  branchId: string,
  processedThrough: number | null,
  ctx: DbCtx,
): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        gt(storyEntries.position, processedThrough ?? 0),
        ne(storyEntries.kind, 'system'),
      ),
    )
  return row?.n ?? 0
}

export async function readClassifierStatus(
  branchId: string,
  ctx: DbCtx,
): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.classifierStatus ?? idleStatus()
}

/**
 * Boot-time orphan reconciliation: a branch left `state: 'running'` was owned by a
 * process that no longer exists. Scoped to `$.state` and to 'running' only —
 * 'retrying' / 'failed-persistent' are real errors the manual run must surface.
 *
 * `unreversedActionIds` are the orphans boot could not reverse-replay. A branch
 * still holding their deltas is NOT reconcilable, so it keeps `running`, which
 * already suspends the cadence — reconciling it would let the classifier re-read a
 * window whose partial writes are still on disk. The boot that finally reverses
 * them drops the branch from this set and reconciles it normally; `[Run classifier
 * now]` overrides in the meantime, which is the user's call to make.
 */
export async function resetStuckClassifierRunState(
  ctx: DbCtx,
  unreversedActionIds: readonly string[],
): Promise<void> {
  // Keyed on surviving deltas, not on the failure alone: the boot path reverses
  // without pruning, so a failure that left nothing behind (the marker write threw
  // after a clean reversal) correctly reconciles.
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
