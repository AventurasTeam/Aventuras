import { describe, expect, it } from 'vitest'

import { mmrRank } from './mmr'

const v = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs)
  return Float32Array.from(xs, (x) => x / n)
}

describe('mmrRank', () => {
  it('picks the highest-scoring candidate first (S is empty, no penalty)', () => {
    const out = mmrRank(
      [
        { id: 'low', score: 0.4, vector: v(1, 0) },
        { id: 'high', score: 0.9, vector: v(0, 1) },
      ],
      0.75,
    )
    expect(out[0].id).toBe('high')
  })

  it('demotes a near-duplicate of an already-selected candidate', () => {
    // 'dupe' out-scores 'other' on raw score but is collinear with 'first'.
    // λ_div 0.75: dupe = 0.75*0.8 - 0.25*1.0 = 0.35; other = 0.75*0.7 - 0.25*0 = 0.525.
    const out = mmrRank(
      [
        { id: 'first', score: 0.95, vector: v(1, 0) },
        { id: 'dupe', score: 0.8, vector: v(1, 0) },
        { id: 'other', score: 0.7, vector: v(0, 1) },
      ],
      0.75,
    )
    expect(out.map((c) => c.id)).toEqual(['first', 'other', 'dupe'])
    expect(out[2].mmrScore).toBeCloseTo(0.35, 6) // 0.75*0.8 − 0.25*1.0 (max sim vs S, not vs last pick)
  })

  it('returns every candidate exactly once', () => {
    const out = mmrRank(
      [
        { id: 'a', score: 0.3, vector: v(1, 0) },
        { id: 'b', score: 0.2, vector: v(0, 1) },
        { id: 'c', score: 0.1, vector: v(1, 1) },
      ],
      0.75,
    )
    expect(out.map((c) => c.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('carries the mmr score of the round each candidate was picked in', () => {
    const out = mmrRank([{ id: 'only', score: 0.6, vector: v(1, 0) }], 0.75)
    expect(out[0].mmrScore).toBeCloseTo(0.45, 6) // 0.75 * 0.6 - 0.25 * 0
  })

  it('is empty for an empty pool', () => {
    expect(mmrRank([], 0.75)).toEqual([])
  })

  it('records a negative mmr score rather than flooring it at 0', () => {
    const out = mmrRank([{ id: 'neg', score: -0.5, vector: v(1, 0) }], 0.75)
    expect(out[0].mmrScore).toBeCloseTo(-0.375, 6) // 0.75*-0.5 - 0.25*0
  })

  it('tie-breaks by array position when raw scores are equal', () => {
    const out = mmrRank(
      [
        { id: 'a', score: 0.5, vector: v(1, 0) },
        { id: 'b', score: 0.5, vector: v(0, 1) },
      ],
      0.75,
    )
    expect(out[0].id).toBe('a')
  })
})
