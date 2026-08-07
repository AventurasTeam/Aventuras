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
 * Nothing reads `distance`: the ranker computes cosine over the returned vectors
 * instead, and vec0 will not return the match row without it. That top-k is
 * cosine's top-k only because every stored and query vector is unit-norm —
 * enforced by lib/embedder's embedTexts and re-checked in lib/retrieval's
 * cosine, not by vec0 — which makes L2 order and cosine order the same order.
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

export type VectorsByIdParams = {
  branchId: string
  modelId: string
  ids: readonly string[]
}

/**
 * Vectors for an explicit id set — for candidates admitted by something other
 * than a KNN pass, which carry no match row to ride on.
 *
 * Scans the branch partition rather than pushing down, as knnQuery's note says:
 * measured at dim 384, 5ms over 6k rows and 16ms over 20k, and the cost tracks
 * partition size rather than how many ids are asked for. So issue it once for
 * the whole set, and only for ids a KNN pass did not already return.
 *
 * `pk` is unusable here despite being the declared primary key: a single
 * `pk = ?` does push down, but vec0 answers `pk IN (...)` with **zero rows**
 * rather than an error — a silent wrong answer, not a slow one.
 */
export function vectorsByIdQuery(kind: VecTargetKind, dim: number, p: VectorsByIdParams): RowQuery {
  // model_id is not optional: a swap stages a second model's vectors alongside
  // the first in this table, so an unfiltered read can return the wrong family.
  return rowQuery(
    `SELECT id, embedding FROM ${vecTableName(kind, dim)}
          WHERE branch_id = ? AND model_id = ? AND id IN (${p.ids.map(() => '?').join(', ')})`,
    [p.branchId, p.modelId, ...p.ids],
  )
}
