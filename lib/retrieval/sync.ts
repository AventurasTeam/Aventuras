import type { DbCtx, EmbeddedFieldRow, SqlOp } from '@/lib/db'
import {
  EmbedderCallError,
  EmbedderCancelledError,
  EmbedderInitError,
  type EmbedderErrorKind,
} from '@/lib/embedder'

export type SyncStageDeps = {
  branchIds: readonly string[]
  abortSignal?: AbortSignal
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  /** Splits the dirty set: the rows that genuinely drifted, plus flag-clear ops
   *  for the rest (retrieval.md → Compute lifecycle). */
  revalidateRows: (
    rows: EmbeddedFieldRow[],
  ) => Promise<{ staleRows: EmbeddedFieldRow[]; freshOps: SqlOp[] }>
  embedRows: (rows: EmbeddedFieldRow[], abortSignal?: AbortSignal) => Promise<SqlOp[]>
  runInTransaction: DbCtx['runInTransaction']
}

export type SyncStageResult = {
  /**
   * Rows cleared on a matching stored vector, no embed spent. Reported on the
   * failure arm too: the clears commit ahead of the embed and outlive it.
   */
  revalidated: number
} & (
  | { ok: true; embedded: number }
  /**
   * Its own arm, not a reason on the failure one: a user-asked stop is no
   * embedder fault, and "no Switch embedder on a cancel" must not rest on a
   * caller's own outer-signal check.
   */
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; reason: EmbedderErrorKind; detail: string; staleCount: number }
)

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
 * Embeds every row still dirty after revalidation in ONE batch and clears their
 * flags in one transaction (retrieval.md → Compute lifecycle). Blocking where the
 * drain worker is opportunistic (model-management.md → Embed failure is blocking),
 * with no partial-success path — a half-synced index mis-ranks silently. Only the
 * embed call is an embedder fault; a SQL error escapes uncaught, as in the KNN stage.
 */
export async function runSyncStage(deps: SyncStageDeps): Promise<SyncStageResult> {
  const rows = await deps.loadStaleRows(deps.branchIds)
  if (rows.length === 0) return { ok: true, embedded: 0, revalidated: 0 }

  const { staleRows, freshOps } = await deps.revalidateRows(rows)
  // Committed ahead of the embed: a stored vector that already matches justifies
  // the clear on its own, whatever happens to the rows that did drift.
  if (freshOps.length > 0) await deps.runInTransaction(freshOps)
  const revalidated = rows.length - staleRows.length
  if (staleRows.length === 0) return { ok: true, embedded: 0, revalidated }
  // Captured before embedRows sees the array: reading staleRows.length afterwards
  // would let a dep that drains its argument report a confident zero.
  const staleCount = staleRows.length

  let ops: SqlOp[]
  try {
    ops = await deps.embedRows(staleRows, deps.abortSignal)
  } catch (error) {
    if (error instanceof EmbedderCancelledError) return { ok: false, cancelled: true, revalidated }
    return { ok: false, ...classifyEmbedderFailure(error), staleCount, revalidated }
  }

  await deps.runInTransaction(ops)
  return { ok: true, embedded: staleCount, revalidated }
}
