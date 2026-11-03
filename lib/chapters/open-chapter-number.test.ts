import { describe, expect, it } from 'vitest'

import { openChapterNumber } from './open-chapter-number'

const closed = (...numbers: number[]) => numbers.map((sequenceNumber) => ({ sequenceNumber }))

describe('openChapterNumber', () => {
  it('is 1 with no closed chapter', () => {
    expect(openChapterNumber([])).toBe(1)
  })

  it('is one past the highest closed chapter', () => {
    expect(openChapterNumber(closed(1, 2))).toBe(3)
  })

  it('reads the highest whatever the order', () => {
    expect(openChapterNumber(closed(2, 1))).toBe(3)
  })

  it('reads the highest across a gap a deleted chapter left', () => {
    expect(openChapterNumber(closed(1, 4))).toBe(5)
  })
})
