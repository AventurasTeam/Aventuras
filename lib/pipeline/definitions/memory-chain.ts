import { and, eq, gt, ne, sql } from 'drizzle-orm'

import { CHAPTER_CLOSE_KIND, chapterProgressOf } from '@/lib/chapters'
import { idleStatus, PERIODIC_CLASSIFIER_KIND, shouldCadenceFire } from '@/lib/classifier'
import {
  branches,
  openRegionSeries,
  storyEntries,
  type ClassifierStatus,
  type DbCtx,
} from '@/lib/db'
import { currentStoryStore, generationStore, type OpenStory, type RunState } from '@/lib/stores'

/** RejectedStart.blockedBy for a branch held `running` (classifier.md → Failure policy). */
export const CLASSIFIER_HELD = 'classifier-held'

/** A pass's `RunCtx.inputs`; `alone` (Retry, Run now) chains no close after it. */
export type PassInputs = { alone?: true }

export function passStartedAlone(run: Pick<RunState, 'inputs'>): boolean {
  const { inputs } = run
  return typeof inputs === 'object' && inputs !== null && (inputs as PassInputs).alone === true
}

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

/** What Send runs before its turn: `'pass'` starts a chain that may end in the close. */
export type OwedWork = 'held' | 'pass' | 'close' | null

/**
 * Send's check: held first; a stale close record clears; a deferred pass, a close's catch-up or the
 * cadence owes a pass; an owed close with nothing to catch up owes the close.
 */
export async function owedWorkAtSend(branchId: string, ctx: DbCtx): Promise<OwedWork> {
  if (await isClassifierHeld(branchId, ctx)) return 'held'
  const passDeferred = generationStore.getTxState().deferred.get(branchId)?.pass === true
  // The cadence and the close read the open story's settings: off its branch only a deferral owes.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return passDeferred ? 'pass' : null
  const owesClose = await closeOwed(open, ctx)
  // An interrupted close a rollback below the threshold took back leaves nothing to run.
  if (!owesClose) generationStore.clearDeferredClose(branchId)
  const status = await readClassifierStatus(branchId, ctx)
  const unprocessed = await unprocessedEntryCount(branchId, status.processedThrough, ctx)
  if (passDeferred || (owesClose && unprocessed > 0)) return 'pass'
  if (owesClose) return 'close'
  const cadence = open.settings.classifierCadence
  return shouldCadenceFire({ status, unprocessedEntries: unprocessed, cadence }) ? 'pass' : null
}

/**
 * A manual pick, else the open region at the threshold with auto-close on and a reply to end on
 * (C5, C10). Read fresh each time, so a rollback below the threshold owes nothing.
 */
export async function closeOwed(
  story: Pick<OpenStory, 'branchId' | 'settings'>,
  ctx: Pick<DbCtx, 'db'>,
): Promise<boolean> {
  if (generationStore.getTxState().pendingClose.has(story.branchId)) return true
  if (!story.settings.chapterAutoClose) return false
  const progress = chapterProgressOf(
    await openRegionSeries(story.branchId, ctx),
    story.settings.chapterTokenThreshold,
  )
  return progress.tokens >= progress.threshold && progress.canClose
}

// The run's story while it is open on the run's branch: whose settings every chain read uses.
function openStoryOf(run: Pick<RunState, 'storyId' | 'branchId'>): OpenStory | null {
  const open = currentStoryStore.getCurrentStory()
  return open != null && open.storyId === run.storyId && open.branchId === run.branchId
    ? open
    : null
}

type MemoryRunKind = typeof PERIODIC_CLASSIFIER_KIND | typeof CHAPTER_CLOSE_KIND

// `owesClose` is read after the held check, so a held branch never scans its region.
async function memoryRunOn(
  open: OpenStory,
  ctx: DbCtx,
  owesClose: () => Promise<boolean>,
): Promise<MemoryRunKind | null> {
  const status = await readClassifierStatus(open.branchId, ctx)
  // A pass left `running` holds the branch: nothing builds on its writes until boot resets it.
  // A committing pass wrote its status in its phase, so its own chain never reads `running` here.
  if (status.state === 'running') return null
  const unprocessed = await unprocessedEntryCount(open.branchId, status.processedThrough, ctx)
  if (await owesClose()) return unprocessed > 0 ? PERIODIC_CLASSIFIER_KIND : CHAPTER_CLOSE_KIND
  const cadence = open.settings.classifierCadence
  return shouldCadenceFire({ status, unprocessedEntries: unprocessed, cadence })
    ? PERIODIC_CLASSIFIER_KIND
    : null
}

/**
 * The memory run a commit chains (generation-pipeline.md → chainsTo on predecessor). Awaited under
 * the committing run's gate, so no writer moves the count, status or region before the successor.
 */
export async function nextMemoryRun(run: RunState, ctx: DbCtx): Promise<MemoryRunKind | null> {
  const open = openStoryOf(run)
  if (open == null) return null
  return memoryRunOn(open, ctx, () => closeOwed(open, ctx))
}

/**
 * per-turn's `chainsTo`. Interrupted work waits for the next Send, so a regenerated reply doesn't
 * bring it straight back; a Send's own chain reads past the record.
 */
export async function perTurnChainsTo(run: RunState, ctx: DbCtx): Promise<MemoryRunKind | null> {
  if (generationStore.getTxState().deferred.has(run.branchId)) return null
  return nextMemoryRun(run, ctx)
}

/** The pass's `chainsTo`: passes chain catch-up passes and the close only while a close is owed. */
export async function passChainsTo(run: RunState, ctx: DbCtx): Promise<MemoryRunKind | null> {
  if (passStartedAlone(run)) return null
  const open = openStoryOf(run)
  if (open == null || !(await closeOwed(open, ctx))) return null
  return memoryRunOn(open, ctx, async () => true)
}
