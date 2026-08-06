import { rowQuery, type RowQuery } from '../types'
import { vecTableName, type VecTargetKind } from './vec-tables'

// Not blob.slice(): Buffer#slice returns a VIEW, and a driver is free to hand
// back a pooled Buffer whose byteOffset isn't 4-aligned — which a Float32Array
// view rejects outright. The Uint8Array constructor always allocates.
export function unpackFloat32(blob: Uint8Array): Float32Array {
  // A short blob would otherwise yield a short vector rather than throwing:
  // the Float32Array length argument truncates a fractional value.
  if (blob.byteLength % 4 !== 0) {
    throw new Error(`Invalid vector blob length: ${blob.byteLength}`)
  }
  const copy = new Uint8Array(blob)
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
 * not expressible here — they filter the returned ids afterwards.
 *
 * `embedding` rides along because vec0 returns it on the match row for almost
 * nothing, whereas fetching vectors by id afterwards cannot: `id` is a metadata
 * column with no push-down, so such a query scans the whole partition instead.
 * `distance` is logged, not scored: the ranker computes cosine over the
 * returned vectors. That top-k is cosine's top-k only because every stored and
 * query vector is unit-norm — enforced by lib/embedder's embedTexts, not by
 * vec0 — which is what makes L2 order and cosine order the same order.
 */
export function knnQuery(kind: VecTargetKind, dim: number, p: KnnParams): RowQuery {
  // vec0 treats k = 0 as valid and returns nothing, so a misconfigured budget
  // would read as "no candidate was relevant" rather than failing.
  if (!Number.isInteger(p.k) || p.k < 1) {
    throw new Error(`Invalid KNN k: ${p.k}`)
  }
  return rowQuery(
    `SELECT id, distance, embedding FROM ${vecTableName(kind, dim)}
          WHERE embedding MATCH ? AND k = ? AND branch_id = ? AND model_id = ?`,
    [p.vector, p.k, p.branchId, p.modelId],
  )
}
