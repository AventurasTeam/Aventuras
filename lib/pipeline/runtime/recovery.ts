import { asc, eq, isNull } from 'drizzle-orm'

import { pipelineRuns, type DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { reverseReplayDeltas } from './action-port'

export type RecoveredRun = {
  runId: string
  kind: string
  actionId: string
  storyId: string | null
  deltas: number
}
export type RecoveryFailure = {
  runId: string
  kind: string
  actionId: string
  storyId: string | null
  error: unknown
}
export type RecoveryReport = { reversed: RecoveredRun[]; failures: RecoveryFailure[] }

// Never throws — boot must not be blocked by orphan recovery; per-orphan
// failures are logged and the row left for the next boot to retry.
export async function recoverInFlightRuns(ctx: DbCtx): Promise<RecoveryReport> {
  const orphans = await ctx.db
    .select()
    .from(pipelineRuns)
    .where(isNull(pipelineRuns.finishedAt))
    .orderBy(asc(pipelineRuns.startedAt))

  const reversed: RecoveredRun[] = []
  const failures: RecoveryFailure[] = []

  for (const orphan of orphans) {
    try {
      // Settling the marker rides the reversal's own transaction: the replay is not
      // idempotent (undoing a `delete` re-inserts), so an orphan left open over
      // already-reversed deltas fails deterministically on every later boot.
      const count = await reverseReplayDeltas(orphan.actionId, ctx, (deltaCount) => [
        deltaCount === 0
          ? ctx.db.delete(pipelineRuns).where(eq(pipelineRuns.runId, orphan.runId)).toSQL()
          : ctx.db
              .update(pipelineRuns)
              .set({ finishedAt: Date.now(), outcome: 'recovered' })
              .where(eq(pipelineRuns.runId, orphan.runId))
              .toSQL(),
      ])
      if (count === 0) continue
      reversed.push({
        runId: orphan.runId,
        kind: orphan.kind,
        actionId: orphan.actionId,
        storyId: orphan.storyId,
        deltas: count,
      })
      logger.debug('pipeline.recovered', { runId: orphan.runId, kind: orphan.kind, deltas: count })
    } catch (e) {
      // Boot must never be blocked: any per-orphan failure (a DeltaReplayError, or
      // a transient DB error on the marker write) is logged and left for next boot.
      // TODO: consider a stronger resolution to not polute the data, ie. deletion of orphaned data
      failures.push({
        runId: orphan.runId,
        kind: orphan.kind,
        actionId: orphan.actionId,
        storyId: orphan.storyId,
        error: e,
      })
      logger.error('pipeline.recovery_failed', {
        runId: orphan.runId,
        kind: orphan.kind,
        actionId: orphan.actionId,
        error: String(e),
      })
    }
  }

  return { reversed, failures }
}
