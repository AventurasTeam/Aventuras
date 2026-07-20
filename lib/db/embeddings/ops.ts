import type { SqlOp } from '../types'
import { vecTableName, type VecTargetKind } from './vec-tables'

export type VecWrite = {
  kind: VecTargetKind
  id: string
  branchId: string
  modelId: string
  dim: number
  sourceHash: string
  vector: Uint8Array
}

export function upsertVecOps(w: VecWrite): SqlOp[] {
  const table = vecTableName(w.kind, w.dim)
  return [
    ...deleteVecOps(w.kind, w.dim, w.id, w.branchId),
    {
      sql: `INSERT INTO ${table} (id, branch_id, model_id, source_hash, embedding) VALUES (?, ?, ?, ?, ?)`,
      params: [w.id, w.branchId, w.modelId, w.sourceHash, w.vector],
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
  return [{ sql: `DELETE FROM ${table} WHERE id = ? AND branch_id = ?`, params: [id, branchId] }]
}
