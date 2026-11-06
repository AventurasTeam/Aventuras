import { z } from 'zod'

import { dedupeTerms } from '@/lib/keyword-terms'

// A pattern keeps the schema plain JSON Schema and fails a blank field as a parse, so the call
// retries it.
const nonBlank = z.string().regex(/\S/)

/** chapter-close.md → Phase 2 — chapter metadata: the call's reply. */
export const chapterMetadataSchema = z.object({
  title: nonBlank.describe('A few words naming the chapter, as a chapter heading would.'),
  summary: nonBlank.describe('Two to four sentences telling what happened in the chapter.'),
  theme: nonBlank.describe('A short thematic tag, a word or two.'),
  keywords: z
    .array(z.string())
    .describe('Three to eight words or short phrases to browse the chapter by.'),
})

export type ChapterMetadata = z.infer<typeof chapterMetadataSchema>

/** The most browse keywords a chapter keeps (chapter-close.md → Phase 2). */
export const CHAPTER_KEYWORDS_MAX = 8

/** A reply fit for the chapter row. Minted only by `normalizeChapterMetadata`. */
export type NormalizedChapterMetadata = ChapterMetadata & {
  readonly __brand: 'NormalizedChapterMetadata'
}

/** Trimmed fields, and keywords deduped then cut to the cap; too few keywords is kept, not refused. */
export function normalizeChapterMetadata(reply: ChapterMetadata): NormalizedChapterMetadata {
  return {
    title: reply.title.trim(),
    summary: reply.summary.trim(),
    theme: reply.theme.trim(),
    keywords: dedupeTerms(reply.keywords).slice(0, CHAPTER_KEYWORDS_MAX),
  } as NormalizedChapterMetadata
}
