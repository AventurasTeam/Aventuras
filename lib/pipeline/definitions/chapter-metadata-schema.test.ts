import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  CHAPTER_KEYWORDS_MAX,
  chapterMetadataSchema,
  chapterPartSummarySchema,
  normalizeChapterMetadata,
  normalizeChapterPartSummary,
  type ChapterMetadata,
} from './chapter-metadata-schema'

const REPLY: ChapterMetadata = {
  title: 'The Ford at Dusk',
  summary:
    'You waded the marsh and lost the sigil to the current. Mora met you at the ford, and you had no answer for her.',
  theme: 'loss',
  keywords: ['Mora', 'the ford', 'the sigil'],
}

describe('chapterMetadataSchema', () => {
  it('accepts a whole reply', () => {
    expect(chapterMetadataSchema.parse(REPLY)).toEqual(REPLY)
  })

  // chapter-close.md → Phase 2: a blank field is a parse failure, so the call retries it.
  it.each(['title', 'summary', 'theme'] as const)('refuses a blank %s', (field) => {
    expect(chapterMetadataSchema.safeParse({ ...REPLY, [field]: '' }).success).toBe(false)
    expect(chapterMetadataSchema.safeParse({ ...REPLY, [field]: ' \n\t' }).success).toBe(false)
  })

  it('refuses a reply with no keywords list', () => {
    const { keywords, ...rest } = REPLY
    expect(chapterMetadataSchema.safeParse(rest).success).toBe(false)
  })

  // generateStructured renders the schema with z.toJSONSchema, which throws on a transform.
  it('converts to JSON Schema', () => {
    expect(() => z.toJSONSchema(chapterMetadataSchema)).not.toThrow()
  })
})

describe('normalizeChapterMetadata', () => {
  it('trims the title, the summary and the theme', () => {
    expect(
      normalizeChapterMetadata({
        ...REPLY,
        title: '  The Ford at Dusk ',
        summary: ` ${REPLY.summary}\n`,
        theme: ' loss ',
      }),
    ).toEqual(REPLY)
  })

  it('dedupes keywords by their normalized form, keeping the first spelling, and drops blanks', () => {
    expect(
      normalizeChapterMetadata({
        ...REPLY,
        keywords: ['Mora', ' mora ', '', 'The Ford', 'the ford', '  '],
      }).keywords,
    ).toEqual(['Mora', 'The Ford'])
  })

  it('stops at eight keywords', () => {
    expect(CHAPTER_KEYWORDS_MAX).toBe(8)
    const keywords = Array.from({ length: 11 }, (_, i) => `keyword ${i + 1}`)
    expect(normalizeChapterMetadata({ ...REPLY, keywords }).keywords).toEqual([
      'keyword 1',
      'keyword 2',
      'keyword 3',
      'keyword 4',
      'keyword 5',
      'keyword 6',
      'keyword 7',
      'keyword 8',
    ])
  })

  it('caps after the dedupe, so a repeat costs no keyword', () => {
    const keywords = ['Mora', 'MORA', ...Array.from({ length: 8 }, (_, i) => `place ${i + 1}`)]
    expect(normalizeChapterMetadata({ ...REPLY, keywords }).keywords).toEqual([
      'Mora',
      'place 1',
      'place 2',
      'place 3',
      'place 4',
      'place 5',
      'place 6',
      'place 7',
    ])
  })

  // A keyword count isn't worth failing a close over.
  it('keeps a reply with fewer than three keywords', () => {
    expect(normalizeChapterMetadata({ ...REPLY, keywords: ['Mora'] }).keywords).toEqual(['Mora'])
  })
})

describe('chapterPartSummarySchema', () => {
  const PART = { summary: 'You wade into the black water with the sigil held high.' }

  it('accepts a summary', () => {
    expect(chapterPartSummarySchema.parse(PART)).toEqual(PART)
  })

  // As the whole chapter's: a blank summary is a parse failure, so the call retries it.
  it('refuses a blank summary', () => {
    expect(chapterPartSummarySchema.safeParse({ summary: '' }).success).toBe(false)
    expect(chapterPartSummarySchema.safeParse({ summary: ' \n\t' }).success).toBe(false)
  })

  it('refuses a reply with no summary', () => {
    expect(chapterPartSummarySchema.safeParse({}).success).toBe(false)
  })

  it('converts to JSON Schema', () => {
    expect(() => z.toJSONSchema(chapterPartSummarySchema)).not.toThrow()
  })
})

describe('normalizeChapterPartSummary', () => {
  it('trims the summary', () => {
    expect(normalizeChapterPartSummary({ summary: ' The current takes the sigil.\n' })).toBe(
      'The current takes the sigil.',
    )
  })
})
