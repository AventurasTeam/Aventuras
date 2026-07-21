import type { SqlOp } from '../types'
import type { SourceHash } from './source-hash'
import { vecRowPk, vecTableName, type VecTargetKind } from './vec-tables'

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

export function upsertVecOps(w: VecWrite): SqlOp[] {
  const table = vecTableName(w.kind, w.dim)
  return [
    ...deleteVecOps(w.kind, w.dim, w.id, w.branchId),
    {
      sql: `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [vecRowPk(w.branchId, w.id), w.branchId, w.modelId, w.id, w.sourceHash, w.vector],
    },
  ]
}

export function deleteVecOps(
  kind: VecTargetKind,
  dim: number,
  id: string,
  branchId: string,
): SqlOp[] {
  const table = vecTableName(kind, dim)
  return [{ sql: `DELETE FROM ${table} WHERE pk = ?`, params: [vecRowPk(branchId, id)] }]
}
