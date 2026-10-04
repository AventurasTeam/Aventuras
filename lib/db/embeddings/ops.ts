import { BIND_CHUNK } from '../bind-limit'
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

// Scoped to (branch, id, model) so a swap's staged vector never deletes the old model's row.
// `source` gates both ops on the row holding that text: a late write for text since edited
// must not delete the vector a newer embed wrote, since that embed already cleared the flag.
export function upsertVecOps(w: VecWrite, source: VecSourceGuard): SqlOp[] {
  const table = vecTableName(w.kind, w.dim)
  const guard = embeddedSourceGuard(w.kind, {
    id: w.id,
    branchId: w.branchId,
    fields: source.fields,
  })
  const holdsText = `EXISTS (SELECT 1 FROM ${SOURCE_TABLES[w.kind]} WHERE ${guard.sql})`
  return [
    {
      sql: `DELETE FROM ${table} WHERE branch_id = ? AND id = ? AND model_id = ? AND ${holdsText}`,
      params: [w.branchId, w.id, w.modelId, ...guard.params],
    },
    {
      sql: `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) SELECT ?, ?, ?, ?, ?, ? WHERE ${holdsText}`,
      params: [
        vecRowPk(w.branchId, w.id, w.modelId),
        w.branchId,
        w.modelId,
        w.id,
        w.sourceHash,
        w.vector,
        ...guard.params,
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

/**
 * `deleteVecOps` for many ids: vec0 scans the whole table for a branch_id + id match, so one
 * `id IN` statement per table (per `BIND_CHUNK` ids) replaces a scan per id. Never `pk IN` —
 * vec0 answers it with no rows.
 */
export function deleteVecIdsOps(
  kind: VecTargetKind,
  ids: readonly string[],
  branchId: string,
  tableNames: readonly string[],
): SqlOp[] {
  if (ids.length === 0) return []
  return familyTablesFor(kind, tableNames).flatMap((table) => {
    const ops: SqlOp[] = []
    for (let i = 0; i < ids.length; i += BIND_CHUNK) {
      const chunk = ids.slice(i, i + BIND_CHUNK)
      ops.push({
        sql: `DELETE FROM ${table} WHERE branch_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
        params: [branchId, ...chunk],
      })
    }
    return ops
  })
}
