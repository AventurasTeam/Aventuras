import { sql } from 'drizzle-orm'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, deltas, type DbCtx } from '@/lib/db'
import type { RecoveryFailure } from '@/lib/pipeline'

/**
 * Boot resets an orphaned `running` to idle; `failed` keeps its error. A branch holding a failed
 * pass's unreversed deltas stays `running`, held, until a boot reverses them: reconciling would let
 * the pass re-read a window its own partial writes are still on. Another kind's failure holds
 * nothing (generation-pipeline.md → Recovery-failure policy).
 */
export async function resetStuckClassifierRunState(
  ctx: DbCtx,
  failures: readonly Pick<RecoveryFailure, 'kind' | 'actionId'>[],
): Promise<void> {
  const passActionIds = failures
    .filter((f) => f.kind === PERIODIC_CLASSIFIER_KIND)
    .map((f) => f.actionId)
  // Keyed on surviving deltas, not on the failure alone: a reversal prunes what it
  // replays, so an orphan with no deltas left has nothing stranded and reconciles.
  const quarantine =
    passActionIds.length === 0
      ? sql``
      : sql` AND ${branches.id} NOT IN (SELECT ${deltas.branchId} FROM ${deltas}
              WHERE ${deltas.actionId} IN (${sql.join(
                passActionIds.map((id) => sql`${id}`),
                sql`, `,
              )}))`
  await ctx.db.run(
    sql`UPDATE ${branches}
        SET classifier_status = json_set(classifier_status, '$.state', 'idle')
        WHERE json_extract(classifier_status, '$.state') = 'running'${quarantine}`,
  )
}
