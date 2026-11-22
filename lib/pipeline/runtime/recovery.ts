import { desc, eq, isNull, sql } from 'drizzle-orm'

import type { IntegrityRefusal } from '@/lib/actions/types'
import { pipelineRuns, type DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { describeReplayError, reverseRunGroup } from './action-port'

export type RecoveredRun = {
  runId: string
  kind: string
  actionId: string
  storyId: string | null
  deltas: number
  /** A close's re-run whose journal couldn't be written back: its chapter's close was undone. */
  closeUndone?: true
}
export type RecoveryFailure = {
  runId: string
  kind: string
  actionId: string
  storyId: string | null
  error: unknown
} & (
  | {
      /** Set when the reversal was refused as an integrity error, which every boot meets again. */
      refusal: IntegrityRefusal | null
      closeUndone?: never
    }
  | {
      /** A committed reversal refused nothing. */
      refusal: null
      /**
       * Its reversal committed with a re-run's close undone, and only the store sync then failed;
       * the marker is settled, so this report is the only word of it.
       */
      closeUndone: true
    }
)
export type RecoveryReport = { reversed: RecoveredRun[]; failures: RecoveryFailure[] }
/**
 * What boot tells the user: the report, plus the stories whose branch it left held (classifier
 * state still `running` after the reset). `null` when that read failed: every pass failure then
 * reads as holding its branch. `passFailed` when the pass itself threw, so empty lists mean no
 * orphan was read, not that none exist.
 */
export type BootRecoveryReport = RecoveryReport & {
  heldStoryIds: readonly string[] | null
  passFailed?: true
}

// Per-orphan failures are logged and reported, so one bad orphan can't block the rest; an
// uncommitted one keeps its marker open for the next boot. Only the orphan query itself can throw.
export async function recoverInFlightRuns(ctx: DbCtx): Promise<RecoveryReport> {
  // Newest first, as undo goes: a close's re-run may have journaled an older orphan's rows. A pass
  // and its successor can start in one millisecond, so insertion order breaks the tie.
  const orphans = await ctx.db
    .select()
    .from(pipelineRuns)
    .where(isNull(pipelineRuns.finishedAt))
    .orderBy(desc(pipelineRuns.startedAt), desc(sql`rowid`))

  const reversed: RecoveredRun[] = []
  const failures: RecoveryFailure[] = []

  for (const orphan of orphans) {
    try {
      const settled = { reversed: false }
      // Marker rides the reversal's transaction: never claims an uncommitted reversal. An orphan
      // with nothing reversed or written back is deleted.
      const result = await reverseRunGroup(
        { actionId: orphan.actionId, branchId: null, rerunChapterId: orphan.rerunChapterId },
        ctx,
        (anything) => {
          settled.reversed = anything
          return [
            anything
              ? ctx.db
                  .update(pipelineRuns)
                  .set({ finishedAt: Date.now(), outcome: 'recovered' })
                  .where(eq(pipelineRuns.runId, orphan.runId))
                  .toSQL()
              : ctx.db.delete(pipelineRuns).where(eq(pipelineRuns.runId, orphan.runId)).toSQL(),
          ]
        },
      )
      if (!settled.reversed) continue
      const closeUndone = result.journal === 'undone'
      reversed.push({
        runId: orphan.runId,
        kind: orphan.kind,
        actionId: orphan.actionId,
        storyId: orphan.storyId,
        deltas: result.deltas,
        ...(closeUndone ? { closeUndone: true as const } : {}),
      })
      logger.debug('pipeline.recovered', {
        runId: orphan.runId,
        kind: orphan.kind,
        deltas: result.deltas,
        journal: result.journal,
      })
    } catch (e) {
      const described = describeReplayError(e)
      const closeUndone = described?.rerun?.journal === 'undone'
      failures.push({
        runId: orphan.runId,
        kind: orphan.kind,
        actionId: orphan.actionId,
        storyId: orphan.storyId,
        error: e,
        ...(closeUndone
          ? { refusal: null, closeUndone: true as const }
          : { refusal: described?.refusal ?? null }),
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
