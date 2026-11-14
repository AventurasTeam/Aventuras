import type { Delta } from '@/lib/db'

import type { DbCtx, PrecedenceTable, RowGuard, RowGuardArgs, RowVerdicts } from '../types'
import { laterTurnDeltas } from './later-turn'
import { proseLogPosition, userEditsOnRows, wroteField } from './user-precedence'

const rowKey = (table: string, id: string) => `${table}:${id}`

/**
 * User precedence and C12 for a close write's rows, read once ahead of its group: edits after
 * `proseEntryId`'s prose and later-turn deltas, by `wroteField` groups (a create writes all).
 */
export async function readRowGuard(args: RowGuardArgs, ctx: DbCtx): Promise<RowGuard> {
  const { branchId, endEntryId, proseEntryId, rows } = args
  const since = await proseLogPosition(ctx, branchId, proseEntryId)
  const later = await laterTurnDeltas(ctx, branchId, endEntryId, rows)
  // One read per table of every user edit: those after the prose are the cited turn's, all are ever.
  const idsByTable = new Map<PrecedenceTable, Set<string>>()
  for (const { table, id } of rows)
    idsByTable.set(table, (idsByTable.get(table) ?? new Set()).add(id))
  const everByRow = new Map<string, Delta[]>()
  for (const [table, ids] of idsByTable)
    for (const edit of await userEditsOnRows(ctx, branchId, table, [...ids], 0)) {
      const key = rowKey(table, edit.targetId)
      everByRow.set(key, [...(everByRow.get(key) ?? []), edit])
    }
  const verdicts = new Map<string, RowVerdicts>()
  for (const { table, id } of rows) {
    const key = rowKey(table, id)
    if (verdicts.has(key)) continue
    const everUser = everByRow.get(key) ?? []
    const user = everUser.filter((d) => d.logPosition > since)
    const laterOnRow = later.filter((d) => d.targetTable === table && d.targetId === id)
    verdicts.set(key, {
      laterTurnWrote: (column, path = []) => wroteField(laterOnRow, table, column, path),
      userWrote: (column, path = []) => wroteField(user, table, column, path),
      laterTurnTouched: () => laterOnRow.length > 0,
      userEverWrote: (column, path = []) => wroteField(everUser, table, column, path),
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
