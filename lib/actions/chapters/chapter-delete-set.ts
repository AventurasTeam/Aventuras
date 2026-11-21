import { and, desc, eq } from 'drizzle-orm'

import { chapters, type Chapter, type Delta } from '@/lib/db'

import { readChapterCloseGroups } from './close-groups'
import { logReversalRefused } from '../delta/commit-new-action'
import { ReversalIntegrityError } from '../delta/replay-errors'
import { selectReversalSet, type ReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'

/** `'whole'` reverses the close groups; `'divider-only'` the row, its report and its stamps. */
export type ChapterDeleteMode = 'whole' | 'divider-only'

export const CHAPTER_DELETE_REFUSAL = {
  inFlight: 'in-flight',
  notFound: 'not-found',
  notLatest: 'not-latest',
  noClose: 'no-close',
  integrity: 'integrity',
} as const

export type ChapterDeleteRefusalCode =
  (typeof CHAPTER_DELETE_REFUSAL)[keyof typeof CHAPTER_DELETE_REFUSAL]

export type ChapterDeleteRefusal<C extends ChapterDeleteRefusalCode = ChapterDeleteRefusalCode> = {
  status: 'rejected'
  code: C
  reason: string
}

/** Only the action refuses `in-flight`: the preview reads under a run. */
export type ChapterDeleteReadRefusal = ChapterDeleteRefusal<
  Exclude<ChapterDeleteRefusalCode, typeof CHAPTER_DELETE_REFUSAL.inFlight>
>

export type ChapterDeleteSet = {
  set: ReversalSet
  chapter: Chapter
  /** Every delta of the chapter's close groups, newest first. */
  groups: readonly Delta[]
}

// C1: a close writes no entries, so its rows on these are the chapter row, its report and stamps.
const DIVIDER_TABLES: ReadonlySet<string> = new Set(['chapters', 'story_entries'])

function refused(code: ChapterDeleteReadRefusal['code'], reason: string): ChapterDeleteReadRefusal {
  return { status: 'rejected', code, reason }
}

export function integrityRefused(
  branchId: string,
  e: ReversalIntegrityError,
): ChapterDeleteReadRefusal {
  logReversalRefused(branchId, e)
  return refused(CHAPTER_DELETE_REFUSAL.integrity, e.message)
}

/** C13's read and seed. Writes nothing; the caller holds the bracket or the shared write lock. */
export async function resolveChapterDeleteSet(
  branchId: string,
  chapterId: string,
  mode: ChapterDeleteMode,
  ctx: DbCtx,
): Promise<ChapterDeleteSet | ChapterDeleteReadRefusal> {
  const [chapter] = await ctx.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), eq(chapters.id, chapterId)))
  if (!chapter)
    return refused(CHAPTER_DELETE_REFUSAL.notFound, `chapter ${branchId}:${chapterId} not found`)

  // A close can commit under an open confirm, and reversing an earlier chapter would strand its
  // entries before a closed one.
  const [latest] = await ctx.db
    .select({ sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
    .orderBy(desc(chapters.sequenceNumber))
    .limit(1)
  if (latest.sequenceNumber !== chapter.sequenceNumber)
    return refused(
      CHAPTER_DELETE_REFUSAL.notLatest,
      `chapter ${chapter.sequenceNumber} is not the latest; ${latest.sequenceNumber} is`,
    )

  const groups = await readChapterCloseGroups(branchId, chapterId, ctx)
  if (groups.length === 0)
    return refused(
      CHAPTER_DELETE_REFUSAL.noClose,
      `no close wrote chapter ${branchId}:${chapterId}`,
    )
  const target = mode === 'whole' ? groups : groups.filter((d) => DIVIDER_TABLES.has(d.targetTable))
  try {
    const set = await selectReversalSet(ctx, { branchId, target })
    return { set, chapter, groups }
  } catch (e) {
    if (e instanceof ReversalIntegrityError) return integrityRefused(branchId, e)
    throw e
  }
}
