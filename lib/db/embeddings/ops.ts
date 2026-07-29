import type { SqlOp } from '../types'
import type { SourceHash } from './source-hash'
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

// vec0 stores embeddings as little-endian float32 blobs; every platform we target
// is little-endian, so the Float32Array's backing bytes are the on-disk format.
// A view (not a copy) is safe because callers hand the vector off and don't mutate.
export function packFloat32(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
}

// Scoped to (branch, id, model) so staging a new model's vector next to an
// existing one during a swap never deletes the old model's row.
export function upsertVecOps(w: VecWrite): SqlOp[] {
  const table = vecTableName(w.kind, w.dim)
  return [
    {
      sql: `DELETE FROM ${table} WHERE branch_id = ? AND id = ? AND model_id = ?`,
      params: [w.branchId, w.id, w.modelId],
    },
    {
      sql: `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        vecRowPk(w.branchId, w.id, w.modelId),
        w.branchId,
        w.modelId,
        w.id,
        w.sourceHash,
        w.vector,
      ],
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
