import { describe, expect, it } from 'vitest'

import { chapterWriteSchema } from './chapter-schema'

const VALID = {
  sequenceNumber: 1,
  title: 'The Gathering Storm',
  summary: 'Heroes assemble as war looms.',
  theme: 'rising tension',
  startEntryId: 'se_1',
  endEntryId: 'se_40',
  tokenCount: 24000,
  closedAt: 100,
}

describe('chapterWriteSchema', () => {
  it('parses a valid row; keywords may be omitted (defaulted column is optional)', () => {
    expect(chapterWriteSchema.safeParse(VALID).success).toBe(true)
  })

  it('accepts a string[] keywords; rejects non-string elements', () => {
    expect(chapterWriteSchema.safeParse({ ...VALID, keywords: ['war', 'omen'] }).success).toBe(true)
    expect(chapterWriteSchema.safeParse({ ...VALID, keywords: [1] }).success).toBe(false)
  })

  it('rejects a non-integer token_count', () => {
    expect(chapterWriteSchema.safeParse({ ...VALID, tokenCount: 1.5 }).success).toBe(false)
  })

  it('rejects a missing required field (title)', () => {
    const { title, ...rest } = VALID
    expect(chapterWriteSchema.safeParse(rest).success).toBe(false)
  })
})
