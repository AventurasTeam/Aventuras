import { z } from 'zod'

import type { PipelineAction } from '@/lib/actions'
import type { Chapter } from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'

/** Draft-schema issue messages; each is a `chapters:validation.*` key the copy translates. */
export const CHAPTER_ISSUE = {
  titleRequired: 'titleRequired',
  summaryRequired: 'summaryRequired',
} as const

export type ChapterIssue = (typeof CHAPTER_ISSUE)[keyof typeof CHAPTER_ISSUE]

const ISSUES: readonly string[] = Object.values(CHAPTER_ISSUE)

export function isChapterIssue(message: string): message is ChapterIssue {
  return ISSUES.includes(message)
}

// chapter-timeline.md → Expanded state: the theme is a free-form tag and may go blank.
export const chapterDraftSchema = z.object({
  title: z.string().trim().min(1, CHAPTER_ISSUE.titleRequired),
  theme: z.string(),
  summary: z.string().trim().min(1, CHAPTER_ISSUE.summaryRequired),
  keywords: z.array(z.string()),
})
export type ChapterDraft = z.infer<typeof chapterDraftSchema>

export const EMPTY_CHAPTER_DRAFT: Readonly<ChapterDraft> = Object.freeze({
  title: '',
  theme: '',
  summary: '',
  keywords: [],
})

/** Pick, not Chapter or StoreChapter: both carry these columns. */
export type ChapterDraftRow = Pick<Chapter, 'id' | 'title' | 'theme' | 'summary' | 'keywords'>

/** New arrays every call; null gives a copy of EMPTY_CHAPTER_DRAFT. */
export function chapterDraftFrom(row: ChapterDraftRow | null): ChapterDraft {
  // The freeze is shallow, so a spread alone would share the constant's array.
  if (row == null) return { ...EMPTY_CHAPTER_DRAFT, keywords: [] }
  return { title: row.title, theme: row.theme, summary: row.summary, keywords: [...row.keywords] }
}

type ChapterPatch = Partial<Pick<Chapter, 'title' | 'theme' | 'summary' | 'keywords'>>

// Not lib/world's: lib/chapters takes no value import of a lib module (M5 C5).
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Columns whose committed value differs from the draft, compared normalized to normalized. */
function chapterPatch(row: ChapterDraftRow, draft: ChapterDraft): ChapterPatch {
  const patch: ChapterPatch = {}
  const title = draft.title.trim()
  if (title !== row.title.trim()) patch.title = title
  const theme = draft.theme.trim()
  if (theme !== row.theme.trim()) patch.theme = theme
  const summary = draft.summary.trim()
  if (summary !== row.summary.trim()) patch.summary = summary
  // Deduped under normalizeTerm (M4 C12): padding and repeats aren't edits, but a re-cased term is.
  const keywords = dedupeTerms(draft.keywords)
  if (!sameList(keywords, dedupeTerms(row.keywords))) patch.keywords = keywords
  return patch
}

/** One `updateChapter` (source `user_edit`) with the changed columns, or nothing. */
export function chapterActions({
  branchId,
  row,
  draft,
}: {
  branchId: string
  row: ChapterDraftRow
  draft: ChapterDraft
}): PipelineAction[] {
  const patch = chapterPatch(row, draft)
  if (Object.keys(patch).length === 0) return []
  return [{ kind: 'updateChapter', source: 'user_edit', payload: { branchId, id: row.id, patch } }]
}
