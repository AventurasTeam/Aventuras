import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { idleStatus, PERIODIC_CLASSIFIER_KIND, shouldCadenceFire } from '@/lib/classifier'
import { branches, storyEntries, type ClassifierStatus, type DbCtx } from '@/lib/db'
import { currentStoryStore, generationStore, type RunState } from '@/lib/stores'

/** RejectedStart.blockedBy for a branch held `running` (classifier.md → Failure policy). */
export const CLASSIFIER_HELD = 'classifier-held'

/**
 * Classifiable entries past the watermark — the cadence's input. Counts rows, not position deltas:
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
  ctx: Pick<DbCtx, 'db'>,
): Promise<ClassifierStatus> {
  const [row] = await ctx.db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.classifierStatus ?? idleStatus()
}

// One read of "due" so Send's check and the chain never disagree.
async function cadenceDue(
  branchId: string,
  status: ClassifierStatus,
  cadence: number,
  ctx: DbCtx,
): Promise<boolean> {
  const unprocessed = await unprocessedEntryCount(branchId, status.processedThrough, ctx)
  return shouldCadenceFire({ status, unprocessedEntries: unprocessed, cadence })
}

function passLive(branchId: string): boolean {
  for (const run of generationStore.getTxState().runs.values())
    if (run.kind === PERIODIC_CLASSIFIER_KIND && run.branchId === branchId) return true
  return false
}

/** A persisted `running` with no pass of this process on the branch: a pass left unfinished. */
export async function isClassifierHeld(branchId: string, ctx: Pick<DbCtx, 'db'>): Promise<boolean> {
  // Checked on both sides of the read: a pass live at either one is what wrote `running`.
  if (passLive(branchId)) return false
  const status = await readClassifierStatus(branchId, ctx)
  return status.state === 'running' && !passLive(branchId)
}

/** Send's check, in order: held branch, deferral mark, then cadence over the watermark. */
export async function owedPassAtSend(
  branchId: string,
  ctx: DbCtx,
): Promise<'held' | 'owed' | null> {
  if (await isClassifierHeld(branchId, ctx)) return 'held'
  if (generationStore.getTxState().deferred.get(branchId)?.pass) return 'owed'
  // The cadence is the open story's setting: a branch it isn't on owes nothing by cadence.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return null
  const status = await readClassifierStatus(branchId, ctx)
  return (await cadenceDue(branchId, status, open.settings.classifierCadence, ctx)) ? 'owed' : null
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
  const due = await cadenceDue(run.branchId, status, open.settings.classifierCadence, ctx)
  return due ? PERIODIC_CLASSIFIER_KIND : null
}
