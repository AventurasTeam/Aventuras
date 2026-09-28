import type { SqlOp } from '../types'
import type { SourceHash } from './source-hash'
import { embeddedSourceGuard, SOURCE_TABLES } from './stale'
import { familyTablesFor, vecRowPk, vecTableName, type VecTargetKind } from './vec-tables'

export type VecWrite = {
  kind: VecTargetKind
  id: string
  branchId: string
  modelId: string
  dim: number
  sourceHash: SourceHash
  vector: Uint8Array
}

/** The embedded text the vector was computed from, in `KIND_FIELDS` order. */
export type VecSourceGuard = { fields: readonly (string | null)[] }

// vec0 stores embeddings as little-endian float32 blobs; every platform we target
// is little-endian, so the Float32Array's backing bytes are the on-disk format.
// A view (not a copy) is safe because callers hand the vector off and don't mutate.
export function packFloat32(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
}

// Scoped to (branch, id, model) so staging a new model's vector next to an
// existing one during a swap never deletes the old model's row. With `source`, the insert lands
// only while the row still holds that text, so an embed racing a delete or an edit leaves no vector.
export function upsertVecOps(w: VecWrite, source?: VecSourceGuard): SqlOp[] {
  const table = vecTableName(w.kind, w.dim)
  const values = [
    vecRowPk(w.branchId, w.id, w.modelId),
    w.branchId,
    w.modelId,
    w.id,
    w.sourceHash,
    w.vector,
  ]
  const remove: SqlOp = {
    sql: `DELETE FROM ${table} WHERE branch_id = ? AND id = ? AND model_id = ?`,
    params: [w.branchId, w.id, w.modelId],
  }
  const columns = '(pk, branch_id, model_id, id, source_hash, embedding)'
  if (source === undefined)
    return [
      remove,
      { sql: `INSERT INTO ${table} ${columns} VALUES (?, ?, ?, ?, ?, ?)`, params: values },
    ]
  const guard = embeddedSourceGuard(w.kind, {
    id: w.id,
    branchId: w.branchId,
    fields: source.fields,
  })
  return [
    remove,
    {
      sql: `INSERT INTO ${table} ${columns} SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${SOURCE_TABLES[w.kind]} WHERE ${guard.sql})`,
      params: [...values, ...guard.params],
    },
  ]
}

// Row deletion (e.g. a source row is deleted) has to reach every dim family and
// every model's row for that id, since nothing records which family/model holds
// a given row's vectors.
export function deleteVecOps(
  kind: VecTargetKind,
  id: string,
  branchId: string,
  tableNames: readonly string[],
): SqlOp[] {
  return familyTablesFor(kind, tableNames).map((table) => ({
    sql: `DELETE FROM ${table} WHERE branch_id = ? AND id = ?`,
    params: [branchId, id],
  }))
}
