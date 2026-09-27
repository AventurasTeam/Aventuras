import type { Delta } from '@/lib/db'

type RowRef = { branchId: string; id: string }

/** Minted only here, so an action cannot lock a table its reversals don't. */
export type RowLockKey = string & { readonly __brand: 'RowLockKey' }

const mint = (key: string) => key as RowLockKey

// Entities lock per row; relationships per branch, since a delete names a row id, not a pair.
const LOCK_BY_TABLE = {
  entities: (row: RowRef) => mint(`entities:${row.branchId}:${row.id}`),
  character_relationships: (row: Pick<RowRef, 'branchId'>) =>
    mint(`character_relationships:${row.branchId}`),
}

export type LockedTable = keyof typeof LOCK_BY_TABLE

/** The lock an action writing `table` takes; `deltaLockKeys` gives its reversals the same one. */
export function rowLock<T extends LockedTable>(table: T): (typeof LOCK_BY_TABLE)[T] {
  return LOCK_BY_TABLE[table]
}

function isLockedTable(table: string): table is LockedTable {
  return Object.hasOwn(LOCK_BY_TABLE, table)
}

/** Keys serializing writes to the rows `rows` targets, so a reversal can't straddle a Save. */
export function deltaLockKeys(rows: readonly Delta[]): RowLockKey[] {
  return rows.flatMap((d) =>
    isLockedTable(d.targetTable)
      ? [LOCK_BY_TABLE[d.targetTable]({ branchId: d.branchId, id: d.targetId })]
      : [],
  )
}
