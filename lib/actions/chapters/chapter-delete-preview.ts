import { and, eq, ne, sql } from 'drizzle-orm'

import { closeAfterDelete, type ChapterDeleteAfter } from '@/lib/chapters'
import { openRegionSeries, storyEntries, type Delta } from '@/lib/db'
import { isRetrievalBumpOnly } from '@/lib/row-signals'
import { generationStore, type OpenStory } from '@/lib/stores'

import {
  resolveChapterDeleteSet,
  type ChapterDeleteRefusal,
  type ChapterDeleteSet,
} from './chapter-delete-set'
import { withBranchWriteShared } from '../delta/branch-write-lock'
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
 * The delete confirm's lines (chapter-timeline.md → Delete a chapter), from the `'whole'` set the
 * action reverses. Writes nothing; held shared, as the rollback preview is, so no reversal lands
 * between the set and the region it reads.
 */
export async function getChapterDeletePreview(
  branchId: string,
  chapterId: string,
  story: Pick<OpenStory, 'branchId' | 'settings'>,
  ctx: DbCtx,
): Promise<ChapterDeletePreview | ChapterDeleteRefusal> {
  return withBranchWriteShared(branchId, CHAPTER_DELETE_PREVIEW_LOCK_ID, async () => {
    const resolved = await resolveChapterDeleteSet(branchId, chapterId, 'whole', ctx)
    if ('status' in resolved) return resolved
    const series = await openRegionSeries(branchId, ctx)
    const regionTokens = series.reduce((sum, row) => sum + row.tokens, 0)
    const chapterTokens = await ownEntryTokens(branchId, resolved.chapter.id, ctx)
    return {
      chapterNumber: resolved.chapter.sequenceNumber,
      ...changesOf(resolved),
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

// A created lore row has its own line, the user's later edits of it included, so no write to it
// counts again; the stamps and the chapter row are the delete itself, and a retrieval count bump
// is no change worth showing.
function changesOf({
  set,
  groups,
}: ChapterDeleteSet): Pick<ChapterDeletePreview, 'createdLore' | 'otherChanges'> {
  const createdLore = new Set(
    groups.filter((d) => d.op === 'create' && d.targetTable === 'lore').map((d) => d.targetId),
  )
  let userEdited = false
  let otherChanges = set.refClears.length
  for (const d of set.rows) {
    if (d.targetTable === 'lore' && createdLore.has(d.targetId)) {
      if (d.source === 'user_edit') userEdited = true
    } else if (!countsNowhere(d)) otherChanges++
  }
  return { createdLore: { count: createdLore.size, userEdited }, otherChanges }
}

function countsNowhere(d: Delta): boolean {
  return (
    d.targetTable === 'story_entries' ||
    d.targetTable === 'chapters' ||
    isRetrievalBumpOnly(d.op, d.undoPayload)
  )
}
