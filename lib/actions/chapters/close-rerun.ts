import { and, asc, desc, eq, gt, gte, lt, ne, sql } from 'drizzle-orm'

import { modelConfigOf, resolveModel } from '@/lib/ai'
import { chapterProgressOf, isCloseOwed } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  branches,
  chapters,
  deltas,
  openRegionSeries,
  storyEntries,
  type Delta,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending } from '@/lib/embedder-swap'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  CLOSE_TARGET,
  ensureChapterClosePipelineRegistered,
  ensurePeriodicClassifierPipelineRegistered,
  getPipeline,
  isClassifierHeld,
  preflightSnapshot,
  readClassifierStatus,
  runPreflight,
  unprocessedThroughChapter,
  type ChainEnd,
  type ConfigResolverError,
  type PreflightFailedStart,
  type RejectedStart,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  currentStoryStore,
  generationStore,
  isBranchHeld,
  isStoryBusy,
  RERUN_HELD,
  type OpenStory,
  type PendingMark,
} from '@/lib/stores'

import { ownEntryTokens, reversalImpactOf } from './chapter-delete-preview'
import { MANUAL_CLOSE_REFUSAL, refused as refusedStart, startCloseChain } from './close-chain'
import { DIVIDER_TABLES, readChapterCloseGroups } from './close-groups'
import { withBranchWriteShared } from '../delta/branch-write-lock'
import { logReversalRefused } from '../delta/commit-new-action'
import { ReversalIntegrityError } from '../delta/replay-errors'
import { selectReversalSet, type CountedReversalSet } from '../delta/row-closure'
import {
  resolveSweep,
  rollbackCountsOf,
  sameRollbackCounts,
  sweepToEntry,
  type RollbackCounts,
  type StoryEntryRejection,
} from '../story-entries/operational'
import { bracketProseReversal } from '../story-entries/prose-reversal'
import { STORY_ENTRY_REJECTION } from '../story-entries/register'
import type { DbCtx } from '../types'

const CLOSE_RERUN_PREVIEW_LOCK_ID = 'close-rerun-preview'

export type CloseRerunPreview = {
  chapterNumber: number
  /** The branch's name, for the fork sentence. */
  branchName: string
  /** lore-mgmt's model for the story, override included; null when unresolved. */
  model: string | null
  tokens: number
  reversal: { createdLore: { count: number; userEdited: boolean }; otherChanges: number }
  shortcut: {
    targetEntryId: string
    /** N: the highest-position non-system entry strictly before the target. */
    forkPoint: { entryId: string; position: number }
    /** Replies the shortcut removes. */
    turns: number
    entries: { count: number; first: number; last: number }
    counts: RollbackCounts
  } | null
}

export type CloseRerunShortcut = NonNullable<CloseRerunPreview['shortcut']>

/** A preview with turns since: the only one whose confirm offers the fork. */
export type CloseRerunForkPreview = CloseRerunPreview & { shortcut: CloseRerunShortcut }

export const CLOSE_RERUN_REFUSAL = {
  notFound: 'not-found',
  notLatest: 'not-latest',
  noClose: 'no-close',
  integrity: 'integrity',
  closeOwed: 'close-owed',
} as const

export type CloseRerunRefusalCode = (typeof CLOSE_RERUN_REFUSAL)[keyof typeof CLOSE_RERUN_REFUSAL]

export type CloseRerunReadRefusal = {
  status: 'rejected'
  code: CloseRerunRefusalCode
  reason: string
}

type TurnStart = { id: string; position: number }

function refused(code: CloseRerunRefusalCode, reason: string): CloseRerunReadRefusal {
  return { status: 'rejected', code, reason }
}

function integrityRefused(branchId: string, e: ReversalIntegrityError): CloseRerunReadRefusal {
  logReversalRefused(branchId, e)
  return refused(CLOSE_RERUN_REFUSAL.integrity, e.message)
}

// Only the latest chapter re-runs: later closes build on an earlier one's merges.
async function latestChapter(
  branchId: string,
  chapterId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<{ sequenceNumber: number } | CloseRerunReadRefusal> {
  const [chapter] = await ctx.db
    .select({ sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), eq(chapters.id, chapterId)))
  if (!chapter)
    return refused(CLOSE_RERUN_REFUSAL.notFound, `chapter ${branchId}:${chapterId} not found`)
  const [latest] = await ctx.db
    .select({ sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
    .orderBy(desc(chapters.sequenceNumber))
    .limit(1)
  if (latest?.sequenceNumber !== chapter.sequenceNumber)
    return refused(
      CLOSE_RERUN_REFUSAL.notLatest,
      `chapter ${chapter.sequenceNumber} is not the latest; ${latest?.sequenceNumber} is`,
    )
  return chapter
}

// `groups` newest first: the first delta's group is the latest close or re-run.
function latestGroupStart(groups: readonly Delta[]): number {
  const latest = groups[0].actionId
  let start = groups[0].logPosition
  for (const d of groups) if (d.actionId === latest && d.logPosition < start) start = d.logPosition
  return start
}

/** Earliest non-system entry created above `from`; a regenerated reply takes its action too. */
async function firstTurnSince(
  branchId: string,
  from: number,
  ctx: Pick<DbCtx, 'db'>,
): Promise<TurnStart | null> {
  const [first] = await ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, position: storyEntries.position })
    .from(deltas)
    .innerJoin(
      storyEntries,
      and(eq(storyEntries.branchId, deltas.branchId), eq(storyEntries.id, deltas.targetId)),
    )
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.op, 'create'),
        gt(deltas.logPosition, from),
        ne(storyEntries.kind, 'system'),
      ),
    )
    .orderBy(asc(storyEntries.position))
    .limit(1)
  if (first === undefined) return null
  if (first.kind !== 'ai_reply') return { id: first.id, position: first.position }
  const [action] = await ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, position: storyEntries.position })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        lt(storyEntries.position, first.position),
        ne(storyEntries.kind, 'system'),
      ),
    )
    .orderBy(desc(storyEntries.position))
    .limit(1)
  const turn = action?.kind === 'user_action' ? action : first
  return { id: turn.id, position: turn.position }
}

// A system entry is no turn's: the replies and the range leave it out.
async function spanFrom(
  branchId: string,
  position: number,
  ctx: Pick<DbCtx, 'db'>,
): Promise<Pick<CloseRerunShortcut, 'turns' | 'entries'>> {
  const [row] = await ctx.db
    .select({
      count: sql<number>`COUNT(*)`,
      first: sql<number>`MIN(${storyEntries.position})`,
      last: sql<number>`MAX(${storyEntries.position})`,
      turns: sql<number>`SUM(CASE WHEN ${storyEntries.kind} = 'ai_reply' THEN 1 ELSE 0 END)`,
    })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        gte(storyEntries.position, position),
        ne(storyEntries.kind, 'system'),
      ),
    )
  return { turns: row.turns, entries: { count: row.count, first: row.first, last: row.last } }
}

// chapter-close.md → Re-running a close: a fork at N keeps every entry before B and none after.
async function forkPointBefore(
  branchId: string,
  position: number,
  ctx: Pick<DbCtx, 'db'>,
): Promise<CloseRerunShortcut['forkPoint'] | null> {
  const [row] = await ctx.db
    .select({ entryId: storyEntries.id, position: storyEntries.position })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        lt(storyEntries.position, position),
        ne(storyEntries.kind, 'system'),
      ),
    )
    .orderBy(desc(storyEntries.position))
    .limit(1)
  return row ?? null
}

type ShortcutRead = { lines: CloseRerunShortcut; reverses: readonly Delta[] }

// rollback-confirm.md → Counts at the turn, read inside this hold: getRollbackCounts takes its
// own, and the lock isn't reentrant.
async function shortcutTo(
  branchId: string,
  turn: TurnStart,
  ctx: DbCtx,
): Promise<ShortcutRead | CloseRerunReadRefusal> {
  const forkPoint = await forkPointBefore(branchId, turn.position, ctx)
  if (forkPoint === null) {
    // A closed chapter's end entry always stands before B: none means a broken branch.
    logger.error('action_layer.close_rerun_fork_point_missing', {
      branchId,
      targetEntryId: turn.id,
    })
    return refused(CLOSE_RERUN_REFUSAL.integrity, `no entry before ${turn.id} on ${branchId}`)
  }
  const swept = await resolveSweep(branchId, turn.id, ctx)
  if ('status' in swept) return refused(CLOSE_RERUN_REFUSAL.integrity, swept.reason)
  const span = await spanFrom(branchId, turn.position, ctx)
  return {
    lines: {
      targetEntryId: turn.id,
      forkPoint,
      ...span,
      counts: await rollbackCountsOf(swept, ctx),
    },
    reverses: swept.set.rows,
  }
}

/** C10 on the region the shortcut leaves: a pick standing there, or auto-close at threshold. */
async function closeOwedAfter(
  branchId: string,
  shortcutFrom: number | null,
  settings: StorySettings,
  ctx: Pick<DbCtx, 'db'>,
): Promise<boolean> {
  const region = (await openRegionSeries(branchId, ctx)).filter(
    (row) => shortcutFrom === null || row.position < shortcutFrom,
  )
  const pick = generationStore.getTxState().pendingClose.get(branchId)
  // The preview's rule, not closeOwed's any-pick: a pick the shortcut removes owes nothing.
  const pickSurvives = pick !== undefined && region.some((row) => row.id === pick.endEntryId)
  return isCloseOwed(
    chapterProgressOf(region, settings.chapterTokenThreshold),
    settings.chapterAutoClose,
    pickSurvives,
  )
}

function loreModelOf(settings: StorySettings): string | null {
  const resolved = resolveModel(
    CLOSE_TARGET,
    modelConfigOf(appSettingsStore.getAppSettings(), settings),
  )
  return resolved.ok ? resolved.modelId : null
}

/**
 * The re-run confirm's lines (chapter-timeline.md → Re-run a close); the shortcut's only when turns
 * followed. Writes nothing; held shared across its reads.
 */
export async function getCloseRerunPreview(
  branchId: string,
  chapterId: string,
  story: Pick<OpenStory, 'settings'>,
  ctx: DbCtx,
): Promise<CloseRerunPreview | CloseRerunReadRefusal> {
  return withBranchWriteShared(branchId, CLOSE_RERUN_PREVIEW_LOCK_ID, async () => {
    const [branch] = await ctx.db
      .select({ name: branches.name })
      .from(branches)
      .where(eq(branches.id, branchId))
    if (!branch) return refused(CLOSE_RERUN_REFUSAL.notFound, `branch ${branchId} not found`)
    const chapter = await latestChapter(branchId, chapterId, ctx)
    if ('status' in chapter) return chapter
    const groups = await readChapterCloseGroups(branchId, chapterId, ctx)
    if (groups.length === 0)
      return refused(CLOSE_RERUN_REFUSAL.noClose, `no close wrote chapter ${branchId}:${chapterId}`)
    const turn = await firstTurnSince(branchId, latestGroupStart(groups), ctx)
    const shortcut = turn === null ? null : await shortcutTo(branchId, turn, ctx)
    if (shortcut !== null && 'status' in shortcut) return shortcut
    let set: CountedReversalSet
    try {
      set = await selectReversalSet(ctx, {
        branchId,
        target: groups.filter((d) => !DIVIDER_TABLES.has(d.targetTable)),
        reversedFirst: shortcut?.reverses,
      })
    } catch (e) {
      if (e instanceof ReversalIntegrityError) return integrityRefused(branchId, e)
      throw e
    }
    if (await closeOwedAfter(branchId, turn?.position ?? null, story.settings, ctx))
      return refused(
        CLOSE_RERUN_REFUSAL.closeOwed,
        `a close is owed on branch ${branchId}'s open region`,
      )
    return {
      chapterNumber: chapter.sequenceNumber,
      branchName: branch.name,
      model: loreModelOf(story.settings),
      tokens: await ownEntryTokens(branchId, chapterId, ctx),
      // The shortcut runs first: its deltas count on its line, and the reversal's read after it.
      reversal: await reversalImpactOf(branchId, set, groups, ctx, {
        reversedFirst: shortcut?.reverses,
      }),
      shortcut: shortcut?.lines ?? null,
    }
  })
}

/** What the confirm showed; the start checks it again under its mark before the turns go. */
export type CloseRerunExpected = {
  shortcut: { targetEntryId: string; counts: RollbackCounts } | null
  reversal: CloseRerunPreview['reversal']
}

/** What a confirm offering the fork showed: a turn since, always. */
export type CloseRerunForkExpected = CloseRerunExpected & {
  shortcut: NonNullable<CloseRerunExpected['shortcut']>
}

/**
 * The counts moved since the confirm opened; `preview` is the confirm read again under the mark.
 */
export type CloseRerunCountsChanged = {
  status: 'rejected'
  code: 'counts-changed'
  reason: string
  preview: CloseRerunPreview
}

/** The start on a new branch found turns after the close: it never rolls them back. */
export const CLOSE_RERUN_TURNS_FOLLOWED = 'turns-followed'

export type CloseRerunTurnsFollowed = {
  status: 'rejected'
  code: typeof CLOSE_RERUN_TURNS_FOLLOWED
  reason: string
}

type CloseChainStart = ChainEnd | RejectedStart | PreflightFailedStart

/** The chain's end, whose `kind` tells a catch-up pass's end from the re-run's, or the refusal. */
export type CloseRerunStart =
  | CloseChainStart
  | CloseRerunReadRefusal
  | CloseRerunCountsChanged
  | StoryEntryRejection

/** The start on a fork: no shortcut runs, so a turn since refuses, never a sweep or moved counts. */
export type CloseRerunForkStart = CloseChainStart | CloseRerunReadRefusal | CloseRerunTurnsFollowed

function shownStill(expected: CloseRerunExpected, preview: CloseRerunPreview): boolean {
  const { shortcut, reversal } = preview
  const sameShortcut =
    expected.shortcut === null
      ? shortcut === null
      : shortcut !== null &&
        shortcut.targetEntryId === expected.shortcut.targetEntryId &&
        sameRollbackCounts(shortcut.counts, expected.shortcut.counts)
  return (
    sameShortcut &&
    reversal.otherChanges === expected.reversal.otherChanges &&
    reversal.createdLore.count === expected.reversal.createdLore.count &&
    reversal.createdLore.userEdited === expected.reversal.createdLore.userEdited
  )
}

function countsChanged(preview: CloseRerunPreview): CloseRerunCountsChanged {
  return {
    status: 'rejected',
    code: 'counts-changed',
    reason: "the re-run's counts changed since the confirm opened",
    preview,
  }
}

function turnsFollowed(branchId: string): CloseRerunTurnsFollowed {
  return {
    status: 'rejected',
    code: CLOSE_RERUN_TURNS_FOLLOWED,
    reason: `a turn follows the close on branch ${branchId}`,
  }
}

// The chain runs it again at its reserve, after the turns went; this one comes first.
function closePreflight(open: Pick<OpenStory, 'settings'>): ConfigResolverError | null {
  return runPreflight(getPipeline(CHAPTER_CLOSE_KIND), preflightSnapshot(open.settings))
}

// The chain starts with a catch-up pass on the chapter's unprocessed end (memory-chain.ts →
// memoryRunOn), so its settings fail before the turns go; the shortcut never moves that count.
async function catchUpPreflight(
  { branchId, chapterId, story }: Pick<RerunStartArgs, 'branchId' | 'chapterId' | 'story'>,
  ctx: DbCtx,
): Promise<ConfigResolverError | null> {
  const { processedThrough } = await readClassifierStatus(branchId, ctx)
  if ((await unprocessedThroughChapter(branchId, chapterId, processedThrough, ctx)) === 0)
    return null
  ensurePeriodicClassifierPipelineRegistered()
  return runPreflight(getPipeline(PERIODIC_CLASSIFIER_KIND), preflightSnapshot(story.settings))
}

type RerunStartArgs = {
  branchId: string
  chapterId: string
  story: OpenStory
  onStarted?: () => void
}

/** The fork's start refusals on the parent before it forks; holds no mark, starts nothing. */
export type CloseRerunParentCheck =
  | { status: 'clear'; preview: CloseRerunForkPreview }
  | RejectedStart
  | PreflightFailedStart
  | CloseRerunReadRefusal
  | CloseRerunCountsChanged

/**
 * chapter-close.md → Re-running a close, Re-run on new branch: every start refusal, checked on the
 * parent before the fork commits. No pending mark (forkBranch's gate counts every pending turn);
 * writes nothing. A clear preview's fork point is the fork's N. Rejects when a read throws.
 */
export async function checkCloseRerunParent(
  branchId: string,
  chapterId: string,
  expected: CloseRerunForkExpected,
  ctx: DbCtx,
): Promise<CloseRerunParentCheck> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refusedStart(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refusedStart(MANUAL_CLOSE_REFUSAL.swapPending)
  // No classifier-held read: whether an orphan pass's writes would copy is forkBranch's call (C2).
  const txState = generationStore.getTxState()
  if (isBranchHeld(txState, branchId)) return refusedStart(RERUN_HELD)
  // A busy story's leave guard would swallow the tail's reset; a turn body still writes here.
  if (isStoryBusy(txState, open.storyId, branchId) || generationStore.isTurnBodyActive(branchId))
    return refusedStart(MANUAL_CLOSE_REFUSAL.busy)
  ensureChapterClosePipelineRegistered()
  const failed = closePreflight(open)
  if (failed) return { outcome: 'preflight-failed', error: failed }
  const fresh = await getCloseRerunPreview(branchId, chapterId, open, ctx)
  if ('status' in fresh) return fresh
  // No turn since leaves nothing to keep on the parent: the confirm the user pressed is stale.
  const { shortcut } = fresh
  if (shortcut === null || !shownStill(expected, fresh)) return countsChanged(fresh)
  const passFailed = await catchUpPreflight({ branchId, chapterId, story: open }, ctx)
  if (passFailed) return { outcome: 'preflight-failed', error: passFailed }
  return { status: 'clear', preview: { ...fresh, shortcut } }
}

// The in-place start's refusals, then `start` under the pending mark this takes.
async function checkedStart<R>(
  branchId: string,
  ctx: DbCtx,
  start: (open: OpenStory, own: PendingMark) => Promise<R>,
): Promise<R | RejectedStart | PreflightFailedStart> {
  if (currentStoryStore.getCurrentStory()?.branchId !== branchId)
    return refusedStart(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  // A pass ending during the held read can leave the branch held, which that read missed.
  const settled = generationStore.getSettleCount()
  if (await isClassifierHeld(branchId, ctx)) return refusedStart(CLASSIFIER_HELD)

  // No await from here to the mark, so no start or reversal lands between these checks and it.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refusedStart(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refusedStart(MANUAL_CLOSE_REFUSAL.swapPending)
  // Before the shortcut's sweep, which the chain's own refusal would come too late to spare.
  if (isBranchHeld(generationStore.getTxState(), branchId)) return refusedStart(RERUN_HELD)
  if (isStoryBusy(generationStore.getTxState(), open.storyId, branchId))
    return refusedStart(MANUAL_CLOSE_REFUSAL.busy)
  if (generationStore.getSettleCount() !== settled) return refusedStart(MANUAL_CLOSE_REFUSAL.busy)
  ensureChapterClosePipelineRegistered()
  const failed = closePreflight(open)
  if (failed) return { outcome: 'preflight-failed', error: failed }
  return generationStore.bracketPendingTurn(branchId, (_endEarly, own) => start(open, own))
}

/**
 * chapter-close.md → Re-running a close, Roll back & re-run: refusals all precede the turns going.
 * A pending mark spans preview, shortcut and the chain's reserve. Rejects when a read, the sweep or
 * the chain's origin throws. Settings come from the store's open story.
 */
export async function startCloseRerun(
  branchId: string,
  chapterId: string,
  expected: CloseRerunExpected,
  ctx: DbCtx,
  /** Fires once, when the chain's first run reserves (after the mark ends); never on a refusal. */
  opts?: { onStarted?: () => void },
): Promise<CloseRerunStart> {
  return checkedStart(branchId, ctx, (story, own) =>
    rollBackAndRerun(
      { branchId, chapterId, story, onStarted: opts?.onStarted },
      expected,
      ctx,
      own,
    ),
  )
}

/**
 * chapter-close.md → Re-running a close, on the branch a fork just made current: the in-place
 * start's refusals, then the re-run with no shortcut. A turn after the close refuses
 * `turns-followed`. Rejects as startCloseRerun does.
 */
export async function startCloseRerunOnFork(
  branchId: string,
  chapterId: string,
  ctx: DbCtx,
  /** As startCloseRerun's. */
  opts?: { onStarted?: () => void },
): Promise<CloseRerunForkStart> {
  return checkedStart(branchId, ctx, (story, own) =>
    rerunOnFork({ branchId, chapterId, story, onStarted: opts?.onStarted }, ctx, own),
  )
}

async function rollBackAndRerun(
  args: RerunStartArgs,
  expected: CloseRerunExpected,
  ctx: DbCtx,
  own: PendingMark,
): Promise<CloseRerunStart> {
  const { branchId, chapterId, story } = args
  const fresh = await getCloseRerunPreview(branchId, chapterId, story, ctx)
  if ('status' in fresh) return fresh
  if (!shownStill(expected, fresh)) return countsChanged(fresh)
  const passFailed = await catchUpPreflight(args, ctx)
  if (passFailed) return { outcome: 'preflight-failed', error: passFailed }
  if (fresh.shortcut !== null) {
    const { targetEntryId, counts } = fresh.shortcut
    const swept = await bracketProseReversal(branchId, ctx, () =>
      sweepToEntry(branchId, targetEntryId, ctx, counts),
    )
    if (swept.status === 'rejected') {
      if (swept.code !== STORY_ENTRY_REJECTION.countsChanged) return swept
      // The confirm meets one counts-changed shape: its own lines, read again under the mark.
      const reread = await getCloseRerunPreview(branchId, chapterId, story, ctx)
      return 'status' in reread ? reread : countsChanged(reread)
    }
  }
  return rerunChain(args, ctx, own)
}

async function rerunOnFork(
  args: RerunStartArgs,
  ctx: DbCtx,
  own: PendingMark,
): Promise<CloseRerunForkStart> {
  const { branchId, chapterId, story } = args
  const fresh = await getCloseRerunPreview(branchId, chapterId, story, ctx)
  if ('status' in fresh) return fresh
  // The confirm showed no rollback here, so a turn after the close is never swept for it.
  if (fresh.shortcut !== null) return turnsFollowed(branchId)
  const passFailed = await catchUpPreflight(args, ctx)
  if (passFailed) return { outcome: 'preflight-failed', error: passFailed }
  return rerunChain(args, ctx, own)
}

async function rerunChain(
  args: RerunStartArgs,
  ctx: DbCtx,
  own: PendingMark,
): Promise<CloseChainStart> {
  const { branchId, chapterId } = args
  generationStore.setPendingRerun(branchId, { chapterId })
  const record = generationStore.getTxState().pendingRerun.get(branchId)
  try {
    return await startCloseChain(branchId, ctx, {
      pendingMark: own,
      preflight: closePreflight,
      onReserved: () => {
        // A throw here would unwind the re-run it just reserved; a confirm failing to close mustn't.
        try {
          args.onStarted?.()
        } catch (e) {
          logger.warn('action_layer.close_rerun_on_started_threw', {
            branchId,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      },
    })
  } finally {
    // The store clears it at the chain's end; a refused chain has none. A later start's stays.
    if (generationStore.getTxState().pendingRerun.get(branchId) === record)
      generationStore.clearPendingRerun(branchId)
  }
}
