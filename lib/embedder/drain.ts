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

export function createDrainController(deps: DrainDeps) {
  let backoffIdx = -1
  let timer: unknown = null
  let running = false
  let stopped = false

  function schedule(storyId: string, ms: number): void {
    if (timer != null) deps.clearTimer(timer)
    timer = deps.setTimer(() => void drain(storyId), ms)
  }

  async function drain(storyId: string): Promise<void> {
    timer = null
    if (stopped || running || deps.hasActiveRun()) return
    running = true
    try {
      const branchIds = deps.branchIdsFor(storyId)
      const resolution = deps.resolveConfig(storyId)
      if (!resolution.ok) return // unconfigured is not an error here
      const rows = await deps.loadStaleRows(branchIds)
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
          failedRows += batch.length
          firstError ??= error instanceof Error ? error.message : String(error)
          continue
        }
        // Outside the try: a throwing sink must not mark a committed batch failed.
        deps.onDrained(storyId)
      }

      if (failedRows === 0) {
        backoffIdx = -1 // full success resets backoff
        return
      }
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
    }
  }

  return {
    noteIdle(storyId: string): void {
      if (!running) schedule(storyId, 0)
    },
    kick(storyId: string): void {
      backoffIdx = -1
      if (!running) schedule(storyId, 0)
    },
    stop(): void {
      stopped = true
      if (timer != null) deps.clearTimer(timer)
      timer = null
    },
  }
}
