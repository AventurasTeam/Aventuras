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
 * `branch_id`/`model_id` push down in the vec0 query; other pool predicates
 * (injection_mode, status, POV) don't, and filter ids afterwards. `embedding`
 * rides along because `id` has no push-down, so a by-id refetch would scan
 * the whole table instead. `distance` isn't a score — cosine is
 * recomputed — but it orders, and unit-norm vectors make that order equal
 * cosine's, comparable across kinds.
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
 * Scans the whole table, every story and branch at this dim, rather than pushing
 * down: the partition key narrows only a KNN. Measured at dim 384, best of 5 on a
 * cold table: 6ms over 2k rows, 18ms over 6k, 60ms over 20k, 179ms over 60k —
 * linear in the table's rows, and near-flat in the id count (14ms at 1 id against
 * 20ms at 800, over 6k rows). So issue it ONCE
 * for the whole set: splitting the ids buys nothing and costs another full scan.
 * Only ask for ids a KNN pass did not already return. Unchunked by design:
 * a caller whose set can outgrow BIND_CHUNK owns the split.
 *
 * Not by `pk`: rows from before the model joined it (`branchId:id`, see vecRowPk)
 * carry another shape, so reads go by the real columns, as deletes do.
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
