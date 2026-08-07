import type { DbCtx, EmbeddedFieldRow, SqlOp } from '@/lib/db'
import { EmbedderCallError, EmbedderInitError, type EmbedderErrorKind } from '@/lib/embedder'

export type SyncStageDeps = {
  branchIds: readonly string[]
  abortSignal?: AbortSignal
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  embedRows: (rows: EmbeddedFieldRow[], abortSignal?: AbortSignal) => Promise<SqlOp[]>
  runInTransaction: DbCtx['runInTransaction']
}

export type SyncStageResult =
  | { ok: true; embedded: number }
  | { ok: false; reason: EmbedderErrorKind; detail: string; staleCount: number }

/**
 * Typed embedder errors carry their own kind. Anything else the embed call
 * throws — a dead bridge, a bug — has no standing to claim the session is fine,
 * so it takes 'init', which means the session never came up
 * (model-management.md → Failure surfaces).
 */
export function classifyEmbedderFailure(error: unknown): {
  reason: EmbedderErrorKind
  detail: string
} {
  return {
    reason:
      error instanceof EmbedderInitError || error instanceof EmbedderCallError
        ? error.kind
        : 'init',
    detail: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Embeds every dirty row in ONE batch and clears their flags in one transaction,
 * satisfying retrieval.md → Compute lifecycle: "no KNN without a preceding sync".
 *
 * Blocking, where the drain worker is opportunistic: a row this cannot embed
 * fails the turn (model-management.md → Embed failure is blocking). There is no
 * partial-success path — a half-synced index silently mis-ranks or drops the
 * un-embedded rows instead of reporting anything.
 *
 * Only the embed call takes the embedder surface. Reading the dirty set and
 * committing the ops are database work, and model-management.md → Failure
 * surfaces knows two embedder faults, neither of them a SQL one — so a locked
 * database escapes here exactly as it does from the KNN stage (run.ts →
 * runRetrieval) rather than offering a re-index as the fix.
 */
export async function runSyncStage(deps: SyncStageDeps): Promise<SyncStageResult> {
  const rows = await deps.loadStaleRows(deps.branchIds)
  if (rows.length === 0) return { ok: true, embedded: 0 }
  // Captured before embedRows sees the array: reading rows.length afterwards
  // would let a dep that drains its argument report a confident zero.
  const staleCount = rows.length

  let ops: SqlOp[]
  try {
    ops = await deps.embedRows(rows, deps.abortSignal)
  } catch (error) {
    return { ok: false, ...classifyEmbedderFailure(error), staleCount }
  }

  await deps.runInTransaction(ops)
  return { ok: true, embedded: staleCount }
}
