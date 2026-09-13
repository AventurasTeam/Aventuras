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

// Per-orphan failures are logged and their rows left for the next boot, so one bad
// orphan can't block the rest; only the orphan query itself can throw.
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
      // Marker rides the reversal's transaction: never claims an uncommitted reversal.
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
