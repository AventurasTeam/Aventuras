import { describe, expect, it } from 'vitest'

import { tokensThrough } from './tokens-through'

// Running totals: 300, 420, 900, 990, 1500.
const SERIES = [
  { id: 'o1', tokens: 300 },
  { id: 'u1', tokens: 120 },
  { id: 'r1', tokens: 480 },
  { id: 'u2', tokens: 90 },
  { id: 'r2', tokens: 510 },
]

describe('tokensThrough', () => {
  it.each([
    ['o1', 300],
    ['r1', 900],
    ['r2', 1500],
  ])('sums from the first row through %s and no further', (entryId, total) => {
    expect(tokensThrough(SERIES, entryId)).toBe(total)
  })

  it("returns null for an entry the series doesn't hold", () => {
    expect(tokensThrough(SERIES, 'r9')).toBeNull()
  })

  it('returns null on an empty series', () => {
    expect(tokensThrough([], 'r1')).toBeNull()
  })
})
