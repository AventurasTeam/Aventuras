import type { DbCtx, RowGuard, RowGuardArgs, RowVerdicts } from '../types'
import { laterTurnDeltas } from './later-turn'
import { proseLogPosition, userEditsSince, wroteField } from './user-precedence'

const rowKey = (table: string, id: string) => `${table}:${id}`

/**
 * User precedence and C12 for a close write's rows, read once ahead of its group: edits after
 * `proseEntryId`'s prose and later-turn deltas, by `wroteField` groups (a create writes all).
 */
export async function readRowGuard(args: RowGuardArgs, ctx: DbCtx): Promise<RowGuard> {
  const { branchId, endEntryId, proseEntryId, rows } = args
  const since = await proseLogPosition(ctx, branchId, proseEntryId)
  const later = await laterTurnDeltas(ctx, branchId, endEntryId, rows)
  const verdicts = new Map<string, RowVerdicts>()
  for (const { table, id } of rows) {
    const key = rowKey(table, id)
    if (verdicts.has(key)) continue
    const user = await userEditsSince(ctx, branchId, table, id, since)
    const laterOnRow = later.filter((d) => d.targetTable === table && d.targetId === id)
    verdicts.set(key, {
      laterTurnWrote: (column, path = []) => wroteField(laterOnRow, table, column, path),
      userWrote: (column, path = []) => wroteField(user, table, column, path),
      laterTurnTouched: () => laterOnRow.length > 0,
      userTouched: () => user.length > 0,
    })
  }
  return {
    row: (table, id) => {
      const verdict = verdicts.get(rowKey(table, id))
      if (verdict === undefined)
        throw new Error(`readRowGuard: ${rowKey(table, id)} is not among the rows it read`)
      return verdict
    },
  }
}
