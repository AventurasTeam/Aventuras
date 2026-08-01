import type { RowQuery } from './field-rows'
import { vecTableName, type VecTargetKind } from './vec-tables'

/**
 * vec0 ranks by L2 distance — the tables declare no distance_metric, so KNN
 * order matches cosine order only because every stored and query vector is
 * unit-norm (enforced by the embedder facade, not by vec0). For unit vectors
 * ||a-b||² = 2 - 2cos, hence cos = 1 - d²/2. Callers score and trace on the
 * cosine, never on the raw distance.
 *
 * Clamped because float error and any non-unit row would otherwise emit a
 * similarity outside [-1, 1] and corrupt the blend.
 */
export function distanceToCosine(distance: number): number {
  return Math.min(1, Math.max(-1, 1 - (distance * distance) / 2))
}

// Copy first: a Float32Array view throws unless byteOffset is 4-aligned, and a
// driver is free to hand back a blob that views into a pooled buffer.
export function unpackFloat32(blob: Uint8Array): Float32Array {
  const copy = blob.slice()
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

export type KnnParams = {
  branchId: string
  modelId: string
  k: number
  vector: Uint8Array
}

/**
 * One KNN pass over a single (kind, dim) family. `branch_id` is a vec0
 * partition key so the engine pre-filters on it; `model_id` is a metadata
 * column constraint. Pool predicates (injection_mode, status, POV union) are
 * NOT expressible here — they filter the returned ids afterwards.
 */
export function knnQuery(kind: VecTargetKind, dim: number, p: KnnParams): RowQuery {
  return {
    sql: `SELECT id, distance FROM ${vecTableName(kind, dim)}
          WHERE embedding MATCH ? AND k = ? AND branch_id = ? AND model_id = ?`,
    params: [p.vector, p.k, p.branchId, p.modelId],
  }
}

/**
 * Vectors for an explicit id set — the union of the three KNN passes. Fetched
 * once because MMR needs candidate-to-candidate similarity anyway, and the
 * same vectors then yield exact sim_q1..q3 for candidates a given query's
 * top-k missed (which would otherwise have to be treated as zero).
 */
export function vectorsByIdQuery(
  kind: VecTargetKind,
  dim: number,
  branchId: string,
  modelId: string,
  ids: readonly string[],
): RowQuery {
  const table = vecTableName(kind, dim)
  if (ids.length === 0) return { sql: `SELECT id, embedding FROM ${table} WHERE 0`, params: [] }
  const placeholders = ids.map(() => '?').join(', ')
  return {
    sql: `SELECT id, embedding FROM ${table}
          WHERE branch_id = ? AND model_id = ? AND id IN (${placeholders})`,
    params: [branchId, modelId, ...ids],
  }
}
