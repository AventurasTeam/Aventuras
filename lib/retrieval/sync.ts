import type { DbCtx, EmbeddedFieldRow, SqlOp } from '@/lib/db'
import { EmbedderCallError } from '@/lib/embedder'

export type SyncStageDeps = {
  branchIds: readonly string[]
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  embedRows: (rows: EmbeddedFieldRow[]) => Promise<SqlOp[]>
  runInTransaction: DbCtx['runInTransaction']
}

export type SyncStageResult =
  | { ok: true; embedded: number }
  | { ok: false; reason: 'init' | 'call'; detail: string; staleCount: number }

/**
 * Embeds every dirty row in ONE batch and clears their flags in one transaction,
 * satisfying retrieval.md → Compute lifecycle: "no KNN without a preceding sync".
 *
 * Blocking, where the drain worker is opportunistic: a row this cannot embed
 * fails the turn (model-management.md → Embed failure is blocking). There is no
 * partial-success path — a half-synced index silently mis-ranks or drops the
 * un-embedded rows instead of reporting anything.
 *
 * A `loadStaleRows` rejection propagates: the failure branch has to report a
 * `staleCount`, and a failed load is the one case that doesn't know it.
 */
export async function runSyncStage(deps: SyncStageDeps): Promise<SyncStageResult> {
  const rows = await deps.loadStaleRows(deps.branchIds)
  if (rows.length === 0) return { ok: true, embedded: 0 }

  try {
    await deps.runInTransaction(await deps.embedRows(rows))
    return { ok: true, embedded: rows.length }
  } catch (error) {
    return {
      ok: false,
      // Only the call side is discriminated: 'call' means one post-init call
      // failed and 'init' means the session never came up (model-management.md
      // → Failure surfaces), so an untyped throw — a failed write, a bug —
      // lands on 'init' rather than claiming the session is fine.
      reason: error instanceof EmbedderCallError ? 'call' : 'init',
      detail: error instanceof Error ? error.message : String(error),
      staleCount: rows.length,
    }
  }
}
