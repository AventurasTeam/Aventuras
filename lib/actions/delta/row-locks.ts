import type { Delta } from '@/lib/db'

type RowRef = { branchId: string; id: string }

/** Minted only here, so an action cannot lock a table its reversals don't. */
export type RowLockKey = string & { readonly __brand: 'RowLockKey' }

const mint = (key: string) => key as RowLockKey

// Entities lock per row; relationships and happening links per branch, since a delete names a
// row id, not a pair or a happening. A happening's own row shares the links key so its delete's
// child read and commit can't straddle a link write (C3).
const happeningLinks = (row: Pick<RowRef, 'branchId'>) => mint(`happening_links:${row.branchId}`)

const LOCK_BY_TABLE = {
  entities: (row: RowRef) => mint(`entities:${row.branchId}:${row.id}`),
  character_relationships: (row: Pick<RowRef, 'branchId'>) =>
    mint(`character_relationships:${row.branchId}`),
  happenings: happeningLinks,
  happening_involvements: happeningLinks,
  happening_awareness: happeningLinks,
}

export type LockedTable = keyof typeof LOCK_BY_TABLE

/** The lock an action writing `table` takes; `deltaLockKeys` gives its reversals the same one. */
export function rowLock<T extends LockedTable>(table: T): (typeof LOCK_BY_TABLE)[T] {
  return LOCK_BY_TABLE[table]
}

function isLockedTable(table: string): table is LockedTable {
  return Object.hasOwn(LOCK_BY_TABLE, table)
}

/**
 * A delete of an entity, or a reversal that removes or restores one, touches rows naming it in
 * both link families.
 */
export function entityCascadeKeys(row: Pick<RowRef, 'branchId'>): RowLockKey[] {
  return [LOCK_BY_TABLE.character_relationships(row), happeningLinks(row)]
}

/** Keys serializing writes to the rows `rows` targets, so a reversal can't straddle a Save. */
export function deltaLockKeys(rows: readonly Delta[]): RowLockKey[] {
  return rows.flatMap((d) => {
    if (!isLockedTable(d.targetTable)) return []
    const row = { branchId: d.branchId, id: d.targetId }
    const own = LOCK_BY_TABLE[d.targetTable](row)
    return d.targetTable === 'entities' ? [own, ...entityCascadeKeys(row)] : [own]
  })
}
