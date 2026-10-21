import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { idleStatus, PERIODIC_CLASSIFIER_KIND, shouldCadenceFire } from '@/lib/classifier'
import { branches, storyEntries, type ClassifierStatus, type DbCtx } from '@/lib/db'
import { currentStoryStore, generationStore, type RunState } from '@/lib/stores'

/**
 * Classifiable turns past the watermark — the cadence's input. Counts rows, not position deltas:
 * `system` entries occupy positions but are filtered from the window, so a delta fires it early.
 */
export async function unprocessedEntryCount(
  branchId: string,
  processedThrough: number | null,
  ctx: DbCtx,
): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        gt(storyEntries.position, processedThrough ?? 0),
        ne(storyEntries.kind, 'system'),
      ),
    )
  return row?.n ?? 0
}

export async function readClassifierStatus(
  branchId: string,
  ctx: DbCtx,
): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.classifierStatus ?? idleStatus()
}

/**
 * per-turn's `chainsTo` (generation-pipeline.md → chainsTo on predecessor). Awaited at commit under
 * the turn's gate, so no writer moves the count or status between these reads and the pass's start.
 */
export async function nextMemoryRun(
  run: RunState,
  ctx: DbCtx,
): Promise<typeof PERIODIC_CLASSIFIER_KIND | null> {
  const work = generationStore.getTxState().deferred.get(run.branchId)
  if (work?.pass || work?.close) return null
  const open = currentStoryStore.getCurrentStory()
  if (open == null || open.storyId !== run.storyId || open.branchId !== run.branchId) return null
  const status = await readClassifierStatus(run.branchId, ctx)
  const unprocessed = await unprocessedEntryCount(run.branchId, status.processedThrough, ctx)
  const due = shouldCadenceFire({
    status,
    unprocessedEntries: unprocessed,
    cadence: open.settings.classifierCadence,
  })
  return due ? PERIODIC_CLASSIFIER_KIND : null
}
