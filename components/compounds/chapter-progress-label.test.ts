import { describe, expect, it } from 'vitest'

import { chapterProgressCounts, chapterProgressLabel } from './chapter-progress-label'

describe('chapterProgressCounts', () => {
  it('groups both numbers', () => {
    expect(chapterProgressCounts({ tokens: 8_420, threshold: 24_000 })).toBe('8,420 / 24,000 tok')
  })

  it('reads zero tokens', () => {
    expect(chapterProgressCounts({ tokens: 0, threshold: 24_000 })).toBe('0 / 24,000 tok')
  })

  it('leaves a number under a thousand ungrouped', () => {
    expect(chapterProgressCounts({ tokens: 999, threshold: 1_000 })).toBe('999 / 1,000 tok')
  })
})

describe('chapterProgressLabel', () => {
  it('prefixes the counts', () => {
    expect(chapterProgressLabel({ tokens: 8_420, threshold: 24_000 })).toBe(
      'chapter progress · 8,420 / 24,000 tok',
    )
  })
})
