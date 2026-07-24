import type { SqlOp } from '../types'
import { compositeText, parseSourceHash, sourceHash } from './source-hash'
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

// After a successful (re)embed the row is fresh by construction, so this clears
// the flag unconditionally — unlike recomputeStaleOp, which re-derives staleness
// from a hash comparison for content edits that have no fresh vector yet.
export function clearEmbeddingStaleOp(kind: VecTargetKind, id: string, branchId: string): SqlOp {
  return {
    sql: `UPDATE ${SOURCE_TABLES[kind]} SET embedding_stale = 0 WHERE id = ? AND branch_id = ?`,
    params: [id, branchId],
  }
}

export async function recomputeStaleOp(
  row: EmbeddedFieldRow,
  dim: number,
  modelId: string,
  queryOne: (sql: string, params: unknown[]) => Promise<Record<string, unknown> | undefined>,
): Promise<SqlOp> {
  const vecTable = vecTableName(row.kind, dim)
  const vecRow = await queryOne(
    `SELECT source_hash FROM ${vecTable} WHERE branch_id = ? AND id = ? AND model_id = ?`,
    [row.branchId, row.id, modelId],
  )
  const currentHash = sourceHash(compositeText(row.fields))
  // An unparseable stored hash (legacy encoding, a driver handing back a Buffer)
  // is treated as stale rather than silently comparing unequal forever.
  const storedHash = parseSourceHash(vecRow?.source_hash)
  const stale = storedHash !== null && storedHash === currentHash ? 0 : 1

  return {
    sql: `UPDATE ${SOURCE_TABLES[row.kind]} SET embedding_stale = ? WHERE id = ? AND branch_id = ?`,
    params: [stale, row.id, row.branchId],
  }
}
