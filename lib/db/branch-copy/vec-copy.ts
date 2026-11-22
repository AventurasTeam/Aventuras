import type { SqlOp } from '../types'

export type VecCopyTables = { readonly vecTable: string; readonly sourceTable: string }
export type CopyBranches = { readonly from: string; readonly to: string }

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertPlainIdentifier(name: string): void {
  if (!PLAIN_IDENTIFIER.test(name)) {
    throw new Error(`vecCopyStatement: not a plain SQL identifier: ${JSON.stringify(name)}`)
  }
}

/**
 * One vec0 family table's copy of `from`'s vectors into `to`, filtered to rows `to`'s source
 * table holds. `pk` is rebuilt from the columns in `vecRowPk`'s shape, since a row written before
 * the key widened holds `branchId:id`; no predicate reads `pk`, which vec0 answers with no rows.
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
