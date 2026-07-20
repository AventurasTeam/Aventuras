import type { SqlOp } from '../types'
import { compositeText, sourceHash } from './source-hash'
import { vecTableName, type VecTargetKind } from './vec-tables'

export type EmbeddedFieldRow = {
  kind: VecTargetKind
  id: string
  branchId: string
  fields: (string | null)[]
}

const SOURCE_TABLES: Record<VecTargetKind, string> = {
  entity: 'entities',
  lore: 'lore',
  happening: 'happenings',
  thread: 'threads',
  chapter: 'chapters',
}

export async function recomputeStaleOp(
  row: EmbeddedFieldRow,
  dim: number,
  queryOne: (sql: string, params: unknown[]) => Promise<Record<string, unknown> | undefined>,
): Promise<SqlOp> {
  const vecTable = vecTableName(row.kind, dim)
  const vecRow = await queryOne(
    `SELECT source_hash FROM ${vecTable} WHERE id = ? AND branch_id = ?`,
    [row.id, row.branchId],
  )
  const currentHash = sourceHash(compositeText(row.fields))
  const stale = vecRow?.source_hash === currentHash ? 0 : 1

  return {
    sql: `UPDATE ${SOURCE_TABLES[row.kind]} SET embedding_stale = ? WHERE id = ? AND branch_id = ?`,
    params: [stale, row.id, row.branchId],
  }
}
