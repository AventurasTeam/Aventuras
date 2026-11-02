import { describe, expect, it } from 'vitest'

import { chapterProgressTone } from './chapter-progress-tone'

describe('chapterProgressTone', () => {
  it.each([
    [0, 'success'],
    [79.9, 'success'],
    [80, 'warning'],
    [89.9, 'warning'],
    [90, 'danger'],
    [100, 'danger'],
  ])('reads %d as %s', (percent, tone) => {
    expect(chapterProgressTone(percent)).toBe(tone)
  })
})
