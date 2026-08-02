import type { DbCtx, EmbeddedFieldRow, SqlOp } from '@/lib/db'
import { EmbedderCallError, EmbedderInitError } from '@/lib/embedder'

export type SyncStageDeps = {
  branchIds: readonly string[]
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  embedRows: (rows: EmbeddedFieldRow[]) => Promise<SqlOp[]>
  runInTransaction: DbCtx['runInTransaction']
}

export type SyncStageResult =
  | { ok: true; embedded: number }
  | { ok: false; reason: 'init' | 'call'; detail: string; staleCount: number | null }

/**
 * Embeds every dirty row in ONE batch and clears their flags in one transaction,
 * satisfying retrieval.md → Compute lifecycle: "no KNN without a preceding sync".
 *
 * Blocking, where the drain worker is opportunistic: a row this cannot embed
 * fails the turn (model-management.md → Embed failure is blocking). There is no
 * partial-success path — a half-synced index silently mis-ranks or drops the
 * un-embedded rows instead of reporting anything.
 *
 * `staleCount` is null only when the dirty set itself failed to load, so a caller
 * can drop the magnitude rather than present a confident zero — the same
 * contract `countStoryEmbeddableRows` uses for an uncountable story.
 */
export async function runSyncStage(deps: SyncStageDeps): Promise<SyncStageResult> {
  // Captured before embedRows sees the array: re-reading rows.length in the
  // catch would let a dep that drains its argument report a confident zero,
  // which is the one value null is supposed to be distinguishable from.
  let staleCount: number | null = null
  try {
    const rows = await deps.loadStaleRows(deps.branchIds)
    if (rows.length === 0) return { ok: true, embedded: 0 }
    staleCount = rows.length
    await deps.runInTransaction(await deps.embedRows(rows))
    return { ok: true, embedded: staleCount }
  } catch (error) {
    return {
      ok: false,
      // Typed embedder errors carry their own kind. Anything else — a failed
      // read or write, a bug — has no standing to claim the session is fine, so
      // it takes 'init', which means the session never came up
      // (model-management.md → Failure surfaces).
      reason:
        error instanceof EmbedderInitError || error instanceof EmbedderCallError
          ? error.kind
          : 'init',
      detail: error instanceof Error ? error.message : String(error),
      staleCount,
    }
  }
}
