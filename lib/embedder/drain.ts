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
  onDrained: (storyId: string, remaining: number) => void
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
      let remaining = rows.length
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        // A torn-down controller (HMR / re-boot) must not keep draining; bail
        // like the hasActiveRun guard so no further batches or retries fire.
        //
        // resolveConfig is re-read per batch, not just at entry: a swap can start
        // mid-drain, and further batches would embed under the outgoing model and
        // clear embedding_stale on rows the swap's phase-2 flip then deletes.
        if (stopped || deps.hasActiveRun() || !deps.resolveConfig(storyId).ok) return
        const batch = rows.slice(i, i + BATCH_SIZE)
        const ops = await deps.embedRows(resolution.config, batch)
        await deps.runInTransaction(ops)
        remaining -= batch.length
        deps.onDrained(storyId, remaining)
      }
      backoffIdx = -1 // full success resets backoff
    } catch (error) {
      // Never surfaces: the blocking sync stage owns user-facing embed errors.
      logger.debug('embedder.drain_failed', {
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
