import { and, asc, desc, eq, gt, gte, lt, ne, sql } from 'drizzle-orm'

import { modelConfigOf, resolveModel } from '@/lib/ai'
import { chapterProgressOf, thresholdMet } from '@/lib/chapters'
import {
  chapters,
  deltas,
  openRegionSeries,
  storyEntries,
  type Delta,
  type StorySettings,
} from '@/lib/db'
import { isStorySwapPending } from '@/lib/embedder-swap'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  CLOSE_TARGET,
  ensureChapterClosePipelineRegistered,
  getPipeline,
  isClassifierHeld,
  preflightSnapshot,
  runPreflight,
  type ChainEnd,
  type ConfigResolverError,
  type PreflightFailedStart,
  type RejectedStart,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  currentStoryStore,
  generationStore,
  isStoryBusy,
  type OpenStory,
} from '@/lib/stores'

import { ownEntryTokens, reversalImpactOf, reversalRowKey } from './chapter-delete-preview'
import { MANUAL_CLOSE_REFUSAL, refused as refusedStart, startCloseChain } from './close-chain'
import { DIVIDER_TABLES, readChapterCloseGroups } from './close-groups'
import { withBranchWriteShared } from '../delta/branch-write-lock'
import { logReversalRefused } from '../delta/commit-new-action'
import { ReversalIntegrityError } from '../delta/replay-errors'
import { selectReversalSet, type ReversalSet } from '../delta/row-closure'
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
  /** lore-mgmt's model for the story, override included; null when unresolved. */
  model: string | null
  tokens: number
  reversal: { createdLore: { count: number; userEdited: boolean }; otherChanges: number }
  shortcut: {
    targetEntryId: string
    /** Replies the shortcut removes. */
    turns: number
    entries: { count: number; first: number; last: number }
    counts: RollbackCounts
  } | null
}

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

type Shortcut = NonNullable<CloseRerunPreview['shortcut']>
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

/**
 * The first turn since the latest close group: the earliest non-system entry created above
 * `from`, whole, so a reply regenerated since takes its player's action, whose create can sit
 * below the group.
 */
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
): Promise<Pick<Shortcut, 'turns' | 'entries'>> {
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

type ShortcutRead = { lines: Shortcut; rows: ReadonlySet<string> }

// rollback-confirm.md → Counts at the turn, read inside this hold: getRollbackCounts takes its
// own, and the lock isn't reentrant.
async function shortcutTo(
  branchId: string,
  turn: TurnStart,
  ctx: DbCtx,
): Promise<ShortcutRead | CloseRerunReadRefusal> {
  const swept = await resolveSweep(branchId, turn.id, ctx)
  if ('status' in swept) return refused(CLOSE_RERUN_REFUSAL.integrity, swept.reason)
  const span = await spanFrom(branchId, turn.position, ctx)
  return {
    lines: { targetEntryId: turn.id, ...span, counts: await rollbackCountsOf(swept, ctx) },
    rows: new Set(swept.set.rows.map((d) => reversalRowKey(d.targetTable, d.targetId))),
  }
}

/**
 * C10 on the open region the shortcut leaves: a pick whose end entry stands there, or auto-close
 * with that region at the threshold and a reply. A pick the shortcut removes is dropped with it.
 */
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
  if (pick !== undefined && region.some((row) => row.id === pick.endEntryId)) return true
  return (
    settings.chapterAutoClose &&
    thresholdMet(chapterProgressOf(region, settings.chapterTokenThreshold))
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
 * The re-run confirm's lines (chapter-timeline.md → Re-run a close): the reversal's counts, the
 * shortcut's when turns followed the latest close group, and the cost. Writes nothing; held
 * shared, so no reversal lands between its reads.
 */
export async function getCloseRerunPreview(
  branchId: string,
  chapterId: string,
  story: Pick<OpenStory, 'settings'>,
  ctx: DbCtx,
): Promise<CloseRerunPreview | CloseRerunReadRefusal> {
  return withBranchWriteShared(branchId, CLOSE_RERUN_PREVIEW_LOCK_ID, async () => {
    const chapter = await latestChapter(branchId, chapterId, ctx)
    if ('status' in chapter) return chapter
    const groups = await readChapterCloseGroups(branchId, chapterId, ctx)
    if (groups.length === 0)
      return refused(CLOSE_RERUN_REFUSAL.noClose, `no close wrote chapter ${branchId}:${chapterId}`)
    let set: ReversalSet
    try {
      set = await selectReversalSet(ctx, {
        branchId,
        target: groups.filter((d) => !DIVIDER_TABLES.has(d.targetTable)),
      })
    } catch (e) {
      if (e instanceof ReversalIntegrityError) return integrityRefused(branchId, e)
      throw e
    }
    const turn = await firstTurnSince(branchId, latestGroupStart(groups), ctx)
    const shortcut = turn === null ? null : await shortcutTo(branchId, turn, ctx)
    if (shortcut !== null && 'status' in shortcut) return shortcut
    if (await closeOwedAfter(branchId, turn?.position ?? null, story.settings, ctx))
      return refused(
        CLOSE_RERUN_REFUSAL.closeOwed,
        `a close is owed on branch ${branchId}'s open region`,
      )
    return {
      chapterNumber: chapter.sequenceNumber,
      model: loreModelOf(story.settings),
      tokens: await ownEntryTokens(branchId, chapterId, ctx),
      reversal: await reversalImpactOf(branchId, set, groups, ctx, {
        excludeRows: shortcut?.rows,
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

/** The counts moved since the confirm opened; `preview` is the confirm read again under the mark. */
export type CloseRerunCountsChanged = {
  status: 'rejected'
  code: 'counts-changed'
  reason: string
  preview: CloseRerunPreview
}

/** The chain's end, whose `kind` tells a catch-up pass's end from the re-run's, or the refusal. */
export type CloseRerunStart =
  | ChainEnd
  | RejectedStart
  | PreflightFailedStart
  | CloseRerunReadRefusal
  | CloseRerunCountsChanged
  | StoryEntryRejection

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

// The chain runs it again at its reserve, after the turns went; this one comes first.
function closePreflight(open: Pick<OpenStory, 'settings'>): ConfigResolverError | null {
  return runPreflight(getPipeline(CHAPTER_CLOSE_KIND), preflightSnapshot(open.settings))
}

type RerunStartArgs = {
  branchId: string
  chapterId: string
  expected: CloseRerunExpected
  story: OpenStory
  onStarted?: () => void
}

/**
 * chapter-close.md → Re-running a close, Roll back & re-run: every refusal comes before the turns
 * go. A pending mark spans the preview, the rollback shortcut and the chain's reserve, so no Send
 * or start lands between them. Rejects when the shortcut's sweep or the chain's origin throws.
 */
export async function startCloseRerun(
  branchId: string,
  chapterId: string,
  expected: CloseRerunExpected,
  story: OpenStory,
  ctx: DbCtx,
  /** onStarted fires once, when the chain's first run reserves (after the mark ends); never on a refusal. */
  opts?: { onStarted?: () => void },
): Promise<CloseRerunStart> {
  if (currentStoryStore.getCurrentStory()?.branchId !== branchId)
    return refusedStart(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (await isClassifierHeld(branchId, ctx)) return refusedStart(CLASSIFIER_HELD)

  // No await from here to the mark, so no start or reversal lands between these checks and it.
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId) return refusedStart(MANUAL_CLOSE_REFUSAL.branchNotOpen)
  if (isStorySwapPending(open.storyId)) return refusedStart(MANUAL_CLOSE_REFUSAL.swapPending)
  if (isStoryBusy(generationStore.getTxState(), open.storyId, branchId))
    return refusedStart(MANUAL_CLOSE_REFUSAL.busy)
  ensureChapterClosePipelineRegistered()
  const failed = closePreflight(open)
  if (failed) return { outcome: 'preflight-failed', error: failed }
  return generationStore.bracketPendingTurn(branchId, (endMark) =>
    startUnderMark(
      { branchId, chapterId, expected, story, onStarted: opts?.onStarted },
      ctx,
      endMark,
    ),
  )
}

async function startUnderMark(
  args: RerunStartArgs,
  ctx: DbCtx,
  endMark: () => void,
): Promise<CloseRerunStart> {
  const { branchId, chapterId, expected, story } = args
  const fresh = await getCloseRerunPreview(branchId, chapterId, story, ctx)
  if ('status' in fresh) return fresh
  if (!shownStill(expected, fresh)) return countsChanged(fresh)
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
  generationStore.setPendingRerun(branchId, { chapterId })
  const record = generationStore.getTxState().pendingRerun.get(branchId)
  try {
    return await startCloseChain(branchId, ctx, {
      ownsPendingMark: true,
      preflight: closePreflight,
      onReserved: () => {
        endMark()
        args.onStarted?.()
      },
    })
  } finally {
    // The store clears it at the chain's end; a chain the orchestrator refused has no end. A
    // record a later start wrote stays.
    if (generationStore.getTxState().pendingRerun.get(branchId) === record)
      generationStore.clearPendingRerun(branchId)
  }
}
