import { eq, getTableColumns, sql, type SQL } from 'drizzle-orm'

import type { DbCtx, SqlOp } from '../types'
import {
  BRANCH_COPY_MANIFEST,
  type BranchCopyTable,
  type BranchCopyTableName,
  type ForkCopy,
  type ForkFilteredTable,
  type ManifestRow,
} from './manifest'
import type { CopyBranches } from './vec-copy'

/** A table's filter; `'all'` copies the table unfiltered. */
export type CopyPredicate = SQL | 'all'

/**
 * `where`: per table, a SQL fragment with its own binds, ANDed into that table's copy; evaluated
 * in-statement, so it reads the batch as earlier ops left it. A fork passes one per filtered table.
 */
export type BranchCopyArgs = CopyBranches &
  (
    | {
        readonly mode: 'duplicate'
        readonly where?: Partial<Record<BranchCopyTableName, CopyPredicate>>
      }
    | {
        readonly mode: 'fork'
        readonly where: Record<ForkFilteredTable, CopyPredicate> &
          Partial<Record<BranchCopyTableName, CopyPredicate>>
      }
  )

const FORK_FILTERS: ReadonlySet<ForkCopy> = new Set<ForkCopy>(['copy-non-system', 'copy-survivors'])

// All in SQL: a JS round trip would re-serialize the JSON columns canon copies verbatim.
function tableCopyOp(
  db: DbCtx['db'],
  table: BranchCopyTable,
  { from, to }: CopyBranches,
  predicate: CopyPredicate | undefined,
): SqlOp {
  const columns = Object.values(getTableColumns(table)).map((column) =>
    column === table.branchId ? sql`${to}` : sql`${column}`,
  )
  const ofSource = eq(table.branchId, from)
  // Parenthesized, unlike drizzle's and(): a predicate's top-level OR would reach other branches.
  const where =
    predicate === undefined || predicate === 'all' ? ofSource : sql`${ofSource} and (${predicate})`
  return db
    .insert(table)
    .select(sql`select ${sql.join(columns, sql`, `)} from ${table} where ${where}`)
    .toSQL()
}

/**
 * The table ops of a branch copy, in manifest order, for the caller's batch; the caller inserts the
 * `branches` row first.
 */
export function branchCopyOps(db: DbCtx['db'], args: BranchCopyArgs): SqlOp[] {
  const where: Partial<Record<BranchCopyTableName, CopyPredicate>> = args.where ?? {}
  const ops: SqlOp[] = []
  for (const [name, row] of Object.entries(BRANCH_COPY_MANIFEST) as [
    BranchCopyTableName,
    ManifestRow,
  ][]) {
    const copy = args.mode === 'fork' ? row.fork : row.duplicate
    if (copy === 'skip') continue
    // The type requires it; an untyped caller would copy the system tail or the pruned deltas.
    if (FORK_FILTERS.has(copy) && where[name] === undefined)
      throw new Error(`branchCopyOps: a fork must pass a predicate for ${name}`)
    ops.push(tableCopyOp(db, row.table, args, where[name]))
  }
  return ops
}
