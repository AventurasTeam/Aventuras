import type { DbCtx, EmbeddedFieldRow, SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import type { EmbedderConfigResolution } from './resolve-config'
import type { EmbedderConfig } from './types'

export type DrainDeps = {
  hasActiveRun: () => boolean
  branchIdsFor: (storyId: string) => readonly string[]
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  resolveConfig: (storyId: string) => EmbedderConfigResolution
  embedRows: (config: EmbedderConfig, rows: EmbeddedFieldRow[]) => Promise<SqlOp[]>
  runInTransaction: DbCtx['runInTransaction']
  /** A batch landed. Carries no count: the story-wide total has one owner. */
  onDrained: (storyId: string) => void
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const BACKOFF_MS = [5_000, 30_000, 120_000] as const
const BATCH_SIZE = 16

const rowKey = (row: EmbeddedFieldRow): string => `${row.kind}:${row.branchId}:${row.id}`

export function createDrainController(deps: DrainDeps) {
  let backoffIdx = -1
  let timer: unknown = null
  let running = false
  let stopped = false
  let pendingKickStoryId: string | null = null
  // Rows that failed alone while their batch-mates succeeded. Runtime-only and
  // per open story: a quarantine that outlived the session would silently keep a
  // row unembedded forever, so reopening the story is always a clean retry.
  const quarantined = new Set<string>()
  let lastStoryId: string | null = null
  // A batch failure only earns per-row isolation on the SECOND consecutive failing
  // pass — a provider outage fails every batch, and isolating it immediately would
  // spend BATCH_SIZE single calls per cycle discovering nothing.
  let isolateOnFailure = false

  function schedule(storyId: string, ms: number): void {
    if (timer != null) deps.clearTimer(timer)
    timer = deps.setTimer(() => void drain(storyId), ms)
  }

  function resetQuarantine(): void {
    quarantined.clear()
    isolateOnFailure = false
  }

  /**
   * Re-runs a failed batch one row at a time. Rows that fail alone are quarantined
   * ONLY if a batch-mate succeeded — if every row fails, the cause is the embedder
   * or the provider, not the content, and quarantining the batch would strand rows
   * that are perfectly embeddable. Returns how many rows are still undrained.
   */
  async function isolateBatch(
    storyId: string,
    config: EmbedderConfig,
    batch: EmbeddedFieldRow[],
  ): Promise<number> {
    const failed: EmbeddedFieldRow[] = []
    for (const [i, row] of batch.entries()) {
      // A teardown mid-isolation leaves the rest undrained, but still flagged.
      if (stopped) return failed.length + (batch.length - i)
      try {
        const ops = await deps.embedRows(config, [row])
        await deps.runInTransaction(ops)
        deps.onDrained(storyId)
      } catch {
        failed.push(row)
      }
    }
    if (failed.length > 0 && failed.length < batch.length) {
      for (const row of failed) quarantined.add(rowKey(row))
      logger.warn('embedder.drain_rows_quarantined', {
        storyId,
        rows: failed.map(rowKey),
      })
    }
    return failed.length
  }

  async function drain(storyId: string): Promise<void> {
    timer = null
    if (stopped || running || deps.hasActiveRun()) return
    running = true
    try {
      const branchIds = deps.branchIdsFor(storyId)
      const resolution = deps.resolveConfig(storyId)
      if (!resolution.ok) return // unconfigured is not an error here
      if (storyId !== lastStoryId) {
        lastStoryId = storyId
        resetQuarantine()
      }
      const rows = (await deps.loadStaleRows(branchIds)).filter(
        (row) => !quarantined.has(rowKey(row)),
      )
      let failedRows = 0
      let firstError: string | null = null

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        // A torn-down controller (HMR / re-boot) must not keep draining; bail
        // like the hasActiveRun guard so no further batches or retries fire.
        //
        // resolveConfig is re-read per batch, not just at entry: a swap can start
        // mid-drain, and further batches would embed under the outgoing model and
        // clear embedding_stale on rows the swap's phase-2 flip then deletes.
        if (stopped || deps.hasActiveRun() || !deps.resolveConfig(storyId).ok) return
        const batch = rows.slice(i, i + BATCH_SIZE)
        try {
          const ops = await deps.embedRows(resolution.config, batch)
          await deps.runInTransaction(ops)
        } catch (error) {
          // Per batch, not per pass: one un-embeddable row must not block the rows
          // behind it. Failed rows keep embedding_stale = 1 and retry next pass.
          firstError ??= error instanceof Error ? error.message : String(error)
          failedRows += isolateOnFailure
            ? await isolateBatch(storyId, resolution.config, batch)
            : batch.length
          continue
        }
        // Outside the try: a throwing sink must not mark a committed batch failed.
        deps.onDrained(storyId)
      }

      if (failedRows === 0) {
        backoffIdx = -1 // full success resets backoff
        isolateOnFailure = false
        return
      }
      // Next failing pass isolates: one clean retry has already been spent, so a
      // still-failing batch is worth the per-row calls to find what is at fault.
      isolateOnFailure = true
      // warn, not debug: a story stuck in backoff leaves no other trace. Canon puts
      // user-facing embed errors on the blocking sync stage, not here.
      logger.warn('embedder.drain_batches_failed', {
        storyId,
        failedRows,
        totalRows: rows.length,
        error: firstError,
      })
      backoffIdx = Math.min(backoffIdx + 1, BACKOFF_MS.length - 1)
      if (!stopped) schedule(storyId, BACKOFF_MS[backoffIdx])
    } catch (error) {
      // Reaching here means the pass itself failed (row load, config), not one
      // batch — nothing was drained, so it is a plain backoff-and-retry.
      logger.warn('embedder.drain_failed', {
        storyId,
        error: error instanceof Error ? error.message : String(error),
      })
      backoffIdx = Math.min(backoffIdx + 1, BACKOFF_MS.length - 1)
      // A stop() mid-flight must not re-arm a zombie retry loop on the dead controller.
      if (!stopped) schedule(storyId, BACKOFF_MS[backoffIdx])
    } finally {
      running = false
      if (!stopped && pendingKickStoryId != null) {
        const storyId = pendingKickStoryId
        pendingKickStoryId = null
        schedule(storyId, 0)
      }
    }
  }

  return {
    noteIdle(storyId: string): void {
      if (!running) schedule(storyId, 0)
    },
    kick(storyId: string): void {
      backoffIdx = -1
      // An explicit kick (embedder recovered, model downloaded) is the signal that
      // the reason a row failed may be gone, so nothing stays quarantined.
      resetQuarantine()
      if (running) pendingKickStoryId = storyId
      else schedule(storyId, 0)
    },
    stop(): void {
      stopped = true
      pendingKickStoryId = null
      if (timer != null) deps.clearTimer(timer)
      timer = null
    },
  }
}
