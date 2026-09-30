import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { upsertVecOps, type VecSourceGuard, type VecWrite } from '../embeddings/ops'
import { vecRowPk, vecTableName } from '../embeddings/vec-tables'

/**
 * Writes `w` through the guarded production upsert, for a vector whose source row holds
 * `source`. Throws on a guard miss, which would otherwise leave the fixture silently empty.
 */
export function seedVec(sqlite: DatabaseSync, w: VecWrite, source: VecSourceGuard): void {
  for (const op of upsertVecOps(w, source)) {
    sqlite.prepare(op.sql).run(...(op.params as SQLInputValue[]))
  }
  const landed = sqlite
    .prepare(
      `SELECT 1 FROM ${vecTableName(w.kind, w.dim)} WHERE branch_id = ? AND id = ? AND model_id = ?`,
    )
    .get(w.branchId, w.id, w.modelId)
  if (landed === undefined) {
    throw new Error(
      `seedVec: ${w.kind} ${w.branchId}/${w.id} does not hold ${JSON.stringify(source.fields)}`,
    )
  }
}

/**
 * Inserts `w` with no source check, for a vector that on purpose matches no live row: stale,
 * orphaned, or left over from another model.
 */
export function plantVec(sqlite: DatabaseSync, w: VecWrite): void {
  sqlite
    .prepare(
      `INSERT INTO ${vecTableName(w.kind, w.dim)} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(vecRowPk(w.branchId, w.id, w.modelId), w.branchId, w.modelId, w.id, w.sourceHash, w.vector)
}
