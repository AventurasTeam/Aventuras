import {
  familyTablesFor,
  listVecFamilyTables,
  SOURCE_TABLES,
  VEC_FAMILIES,
  type VecTargetKind,
} from '../embeddings'
import type { DbCtx, SqlOp } from '../types'

export type VecCopyTables = { readonly vecTable: string; readonly sourceTable: string }
export type CopyBranches = { readonly from: string; readonly to: string }

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertPlainIdentifier(name: string): void {
  if (!PLAIN_IDENTIFIER.test(name)) {
    throw new Error(`vecCopyStatement: not a plain SQL identifier: ${JSON.stringify(name)}`)
  }
}

/**
 * Copies `from`'s vectors into `to` for ids in `to`'s source table. Rebuilds `pk` per `vecRowPk`,
 * as pre-widen rows hold `branchId:id`. No predicate reads `pk`: vec0 answers one with no rows.
 */
export function vecCopyStatement(tables: VecCopyTables, branches: CopyBranches): SqlOp {
  const { vecTable, sourceTable } = tables
  assertPlainIdentifier(vecTable)
  assertPlainIdentifier(sourceTable)
  return {
    sql: `INSERT INTO ${vecTable} (pk, branch_id, model_id, id, source_hash, embedding)
SELECT ? || ':' || id || ':' || model_id, ?, model_id, id, source_hash, embedding
FROM ${vecTable}
WHERE branch_id = ?
  AND EXISTS (SELECT 1 FROM ${sourceTable} s WHERE s.branch_id = ? AND s.id = ${vecTable}.id)`,
    params: [branches.to, branches.to, branches.from, branches.to],
  }
}

/**
 * Every family table's copy ops, to run after the table copy. The family list is read now, before
 * the caller's batch, so a family table created after this read is missed (C3).
 */
export async function vecCopyOps(db: DbCtx['db'], branches: CopyBranches): Promise<SqlOp[]> {
  const listed = await listVecFamilyTables(db)
  return (Object.keys(VEC_FAMILIES) as VecTargetKind[]).flatMap((kind) =>
    familyTablesFor(kind, listed).map((vecTable) =>
      vecCopyStatement({ vecTable, sourceTable: SOURCE_TABLES[kind] }, branches),
    ),
  )
}
