import { and, asc, eq, getTableName, gte } from 'drizzle-orm'
import type { BaseSQLiteDatabase, SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { deltas, type dbSchema } from '../schema'
import type { Delta } from '../types'

export type ChainSnapshotArgs = {
  branchId: string
  targetId: string
  /** The oldest requested delta's position: the chain starts there. */
  fromLogPosition: number
  /** The target's table and key columns; the table's SQL name is the chain's target table. */
  row: { table: SQLiteTable; idCol: SQLiteColumn; branchCol: SQLiteColumn }
}

export type ChainSnapshot = {
  /** Every delta on the target from fromLogPosition on, every op, oldest first. */
  chain: Delta[]
  /** The target row as drizzle maps it, or null. */
  row: Record<string, unknown> | null
}

/** The chain and row selects on `db`, unexecuted; each platform runs them atomically. */
export function chainSnapshotQueries<TMode extends 'sync' | 'async', TRunResult>(
  db: BaseSQLiteDatabase<TMode, TRunResult, typeof dbSchema>,
  { branchId, targetId, fromLogPosition, row }: ChainSnapshotArgs,
) {
  // Not chained: on a mode-generic select each call's return type defers; where/orderBy mutate it.
  const chain = db.select().from(deltas).$dynamic()
  chain.where(
    and(
      eq(deltas.branchId, branchId),
      eq(deltas.targetId, targetId),
      eq(deltas.targetTable, getTableName(row.table)),
      gte(deltas.logPosition, fromLogPosition),
    ),
  )
  chain.orderBy(asc(deltas.logPosition))
  const target = db.select().from(row.table).$dynamic()
  target.where(and(eq(row.branchCol, branchId), eq(row.idCol, targetId)))
  return { chain, row: target }
}
