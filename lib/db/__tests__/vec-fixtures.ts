import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { upsertVecOps, type VecSourceGuard, type VecWrite } from '../embeddings/ops'
import { vecRowPk, vecTableName } from '../embeddings/vec-tables'

/** Writes `w` via the guarded production upsert; a guard miss throws rather than seed nothing. */
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

/** Unguarded insert for a vector meant to match no live row: stale, orphaned or another model's. */
export function plantVec(sqlite: DatabaseSync, w: VecWrite): void {
  sqlite
    .prepare(
      `INSERT INTO ${vecTableName(w.kind, w.dim)} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(vecRowPk(w.branchId, w.id, w.modelId), w.branchId, w.modelId, w.id, w.sourceHash, w.vector)
}
