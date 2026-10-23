import type { DbCtx } from '../../types'
import { getRollbackCounts, type RollbackCounts } from '../operational'

/** The counts the rollback confirm shows for `targetId`; throws when the preview refuses. */
export async function shownCounts(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<RollbackCounts> {
  const counts = await getRollbackCounts(branchId, targetId, ctx)
  if ('status' in counts) throw new Error(`preview refused: ${counts.reason}`)
  return counts
}
