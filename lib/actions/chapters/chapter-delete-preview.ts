import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import { closeAfterDelete, type ChapterDeleteAfter } from '@/lib/chapters'
import { chunked, lore, openRegionSeries, storyEntries, type Delta } from '@/lib/db'
import { isRetrievalBumpOnly } from '@/lib/row-signals'
import { generationStore, type OpenStory } from '@/lib/stores'

import { resolveChapterDeleteSet, type ChapterDeleteReadRefusal } from './chapter-delete-set'
import { withBranchWriteShared } from '../delta/branch-write-lock'
import { restoringUpdates } from '../delta/reverse-replay'
import type { ReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'

const CHAPTER_DELETE_PREVIEW_LOCK_ID = 'chapter-delete-preview'

export type ChapterDeletePreview = {
  /** The chapter's `sequenceNumber`, for `Delete chapter <N>?`. */
  chapterNumber: number
  createdLore: { count: number; userEdited: boolean }
  otherChanges: number
  turnsSince: number
  after: ChapterDeleteAfter
}

/**
 * The delete confirm's lines (chapter-timeline.md → Delete a chapter), from the `'whole'` set.
 * Writes nothing; held shared so no reversal lands between the set and the region it reads.
 */
export async function getChapterDeletePreview(
  branchId: string,
  chapterId: string,
  story: Pick<OpenStory, 'branchId' | 'settings'>,
  ctx: DbCtx,
): Promise<ChapterDeletePreview | ChapterDeleteReadRefusal> {
  return withBranchWriteShared(branchId, CHAPTER_DELETE_PREVIEW_LOCK_ID, async () => {
    const resolved = await resolveChapterDeleteSet(branchId, chapterId, 'whole', ctx)
    if ('status' in resolved) return resolved
    const series = await openRegionSeries(branchId, ctx)
    const regionTokens = series.reduce((sum, row) => sum + row.tokens, 0)
    const chapterTokens = await ownEntryTokens(branchId, resolved.chapter.id, ctx)
    return {
      chapterNumber: resolved.chapter.sequenceNumber,
      ...changesOf(
        resolved.set,
        await createdLoreOf(branchId, resolved.groups, ctx),
        await restoringUpdates(resolved.set, ctx),
      ),
      turnsSince: series.filter((row) => row.kind === 'ai_reply').length,
      after: closeAfterDelete({
        tokensAfter: regionTokens + chapterTokens,
        threshold: story.settings.chapterTokenThreshold,
        autoClose: story.settings.chapterAutoClose,
        manualPending: generationStore.getTxState().pendingClose.has(branchId),
      }),
    }
  })
}

// The entries that rejoin the region; `chapters.token_count` is a snapshot from the close.
async function ownEntryTokens(
  branchId: string,
  chapterId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<number> {
  const [row] = await ctx.db
    .select({ tokens: sql<number>`COALESCE(SUM(${storyEntries.contentTokens}), 0)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, branchId),
        eq(storyEntries.chapterId, chapterId),
        ne(storyEntries.kind, 'system'),
      ),
    )
  return row?.tokens ?? 0
}

type CreatedLore = { ids: ReadonlySet<string>; live: ReadonlySet<string> }

// A created row the user deleted since is gone already, so the delete removes only the live ones.
async function createdLoreOf(
  branchId: string,
  groups: readonly Delta[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<CreatedLore> {
  const ids = new Set(
    groups.filter((d) => d.op === 'create' && d.targetTable === 'lore').map((d) => d.targetId),
  )
  const live = new Set<string>()
  for (const chunk of chunked([...ids])) {
    const rows = await ctx.db
      .select({ id: lore.id })
      .from(lore)
      .where(and(eq(lore.branchId, branchId), inArray(lore.id, chunk)))
    for (const row of rows) live.add(row.id)
  }
  return { ids, live }
}

// No write to a created lore row counts again: a live one has its own line, a gone one changes
// nothing. The stamps and chapter row are the delete itself; a retrieval bump isn't worth showing.
function changesOf(
  set: ReversalSet,
  created: CreatedLore,
  restoring: ReadonlySet<string>,
): Pick<ChapterDeletePreview, 'createdLore' | 'otherChanges'> {
  let userEdited = false
  let otherChanges = set.refClears.length
  for (const d of set.rows) {
    if (d.targetTable === 'lore' && created.ids.has(d.targetId)) {
      if (d.source === 'user_edit' && created.live.has(d.targetId)) userEdited = true
    } else if (!countsNowhere(d, restoring)) otherChanges++
  }
  return { createdLore: { count: created.live.size, userEdited }, otherChanges }
}

// An update a later write replaced in every field restores nothing, so the delete leaves it standing.
function countsNowhere(d: Delta, restoring: ReadonlySet<string>): boolean {
  return (
    d.targetTable === 'story_entries' ||
    d.targetTable === 'chapters' ||
    isRetrievalBumpOnly(d.op, d.undoPayload) ||
    (d.op === 'update' && !restoring.has(d.id))
  )
}
