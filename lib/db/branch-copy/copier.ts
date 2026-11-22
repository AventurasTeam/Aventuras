import { eq, getTableColumns, sql, type SQL } from 'drizzle-orm'

import type { DbCtx, SqlOp } from '../types'
import {
  BRANCH_COPY_MANIFEST,
  FORK_FILTERS,
  type BranchCopyTable,
  type BranchCopyTableName,
  type CopiedIn,
  type CopyMode,
  type ForkFilteredTable,
  type ManifestRow,
} from './manifest'
import { vecCopyOps, type CopyBranches } from './vec-copy'

/** A table's filter; `'all'` copies the table unfiltered. */
export type CopyPredicate = SQL | 'all'

type CopyWhere<M extends CopyMode> = Partial<Record<CopiedIn<M>, CopyPredicate>>

type TableCopyArgs = CopyBranches &
  (
    | { readonly mode: 'duplicate'; readonly where?: CopyWhere<'duplicate'> }
    | {
        readonly mode: 'fork'
        readonly where: Record<ForkFilteredTable, CopyPredicate> & CopyWhere<'fork'>
      }
  )

/**
 * `where`: per table, a SQL fragment with its own binds, ANDed into that table's copy; evaluated
 * in-statement, so it reads the batch as earlier ops left it. A fork passes one per filtered table.
 * A subquery over the table it filters aliases it and names the inner columns through the alias:
 * drizzle writes `"table"."col"`, which binds to the inner row if unaliased, else to the copied row.
 * `between`: ops run after the rows copy and before the vectors, which copy only for rows `to` then
 * holds (C3).
 */
export type BranchCopyArgs = TableCopyArgs & { readonly between?: readonly SqlOp[] }

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

export function tableCopyOps(db: DbCtx['db'], args: TableCopyArgs): SqlOp[] {
  const where: Partial<Record<BranchCopyTableName, CopyPredicate>> = args.where ?? {}
  const ops: SqlOp[] = []
  for (const [name, row] of Object.entries(BRANCH_COPY_MANIFEST) as [
    BranchCopyTableName,
    ManifestRow,
  ][]) {
    const copy = row[args.mode]
    if (copy === 'skip') continue
    // The type requires it; an untyped caller would copy the system tail or the pruned deltas.
    if (FORK_FILTERS[copy] && where[name] === undefined)
      throw new Error(`branchCopyOps: a fork must pass a predicate for ${name}`)
    ops.push(tableCopyOp(db, row.table, args, where[name]))
  }
  return ops
}

/**
 * A branch copy's ops for the caller's batch, after its `branches` row: the tables in manifest
 * order, then `between`, then the vectors. A family table created after this call is missed (C3).
 */
export async function branchCopyOps(db: DbCtx['db'], args: BranchCopyArgs): Promise<SqlOp[]> {
  const tableOps = tableCopyOps(db, args)
  const vectorOps = await vecCopyOps(db, args)
  return [...tableOps, ...(args.between ?? []), ...vectorOps]
}
