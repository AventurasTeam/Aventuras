import { eq, getTableColumns, ne, sql, type SQL } from 'drizzle-orm'

import { storyEntries } from '../schema'
import type { DbCtx, SqlOp } from '../types'
import {
  BRANCH_COPY_MANIFEST,
  CALLER_FILTERS,
  type BranchCopyTable,
  type BranchCopyTableName,
  type CopiedIn,
  type CopyMode,
  type ForkPredicateTable,
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
        readonly where: Record<ForkPredicateTable, CopyPredicate> & CopyWhere<'fork'>
      }
  )

/**
 * `where`: per table, SQL with its own binds, ANDed into that table's copy; evaluated in-statement,
 * so it reads the batch as earlier ops left it. A fork must pass one for its deltas and journals;
 * its `system` entries never copy. A subquery over the table it filters aliases it and names inner
 * columns through the alias: drizzle writes `"table"."col"`, which binds to the inner row if
 * unaliased, else to the copied row. `between`: ops run after the rows copy, before the vectors,
 * which copy only for rows `to` then holds (C3).
 */
export type BranchCopyArgs = TableCopyArgs & { readonly between?: readonly SqlOp[] }

// copy-non-system's filter: a fork never copies the parent's error card.
const NON_SYSTEM = ne(storyEntries.kind, 'system')

// All in SQL: a JS round trip would re-serialize the JSON columns canon copies verbatim.
function tableCopyOp(
  db: DbCtx['db'],
  table: BranchCopyTable,
  { from, to }: CopyBranches,
  filters: readonly SQL[],
): SqlOp {
  const columns = Object.values(getTableColumns(table)).map((column) =>
    column === table.branchId ? sql`${to}` : sql`${column}`,
  )
  // Parenthesized, unlike drizzle's and(): a predicate's top-level OR would reach other branches.
  const where = sql.join(
    [eq(table.branchId, from), ...filters.map((filter) => sql`(${filter})`)],
    sql` and `,
  )
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
    const predicate = where[name]
    // The type requires it; an untyped caller would copy the pruned deltas and journals.
    if (CALLER_FILTERS[copy] && predicate === undefined)
      throw new Error(`branchCopyOps: a fork must pass a predicate for ${name}`)
    const filters: SQL[] = copy === 'copy-non-system' ? [NON_SYSTEM] : []
    if (predicate !== undefined && predicate !== 'all') filters.push(predicate)
    ops.push(tableCopyOp(db, row.table, args, filters))
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
