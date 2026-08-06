import { describe, expect, it } from 'vitest'

import { cosine } from './vector'

const unit = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs)
  return Float32Array.from(xs, (x) => x / n)
}

describe('cosine', () => {
  it('is 1 for identical vectors and -1 for opposed ones', () => {
    expect(cosine(unit(1, 0), unit(1, 0))).toBeCloseTo(1, 6)
    expect(cosine(unit(1, 0), unit(-1, 0))).toBeCloseTo(-1, 6)
  })

  it('is 0 for orthogonal vectors and 0.5 at 60 degrees', () => {
    expect(cosine(unit(1, 0), unit(0, 1))).toBeCloseTo(0, 6)
    expect(cosine(unit(1, 0), unit(0.5, Math.sqrt(3) / 2))).toBeCloseTo(0.5, 6)
  })

  it('clamps to [-1, 1] against float drift on near-parallel vectors', () => {
    const v = unit(0.6, 0.8)
    expect(cosine(v, v)).toBeLessThanOrEqual(1)

    const w = Float32Array.from(v, (x) => -x)
    expect(cosine(v, w)).toBeGreaterThanOrEqual(-1)
  })

  it('throws on dimension mismatch instead of silently comparing a prefix', () => {
    expect(() => cosine(unit(1, 0), Float32Array.from([1]))).toThrow(RangeError)
  })

  // The dot product of a non-unit vector exceeds 1, and the clamp turns that
  // into a plausible PERFECT match rather than an obviously wrong number — so
  // one such row top-ranks against every query, on every type, every turn.
  it('throws on a non-unit vector rather than clamping it to a perfect score', () => {
    const rogue = Float32Array.from([2, 2])
    expect(() => cosine(rogue, unit(1, 0))).toThrow(RangeError)
    expect(() => cosine(unit(1, 0), rogue)).toThrow(RangeError)
  })

  // NaN fails every comparison, so MMR's Math.max propagates it to every
  // remaining candidate and the whole type drops out as below-threshold.
  it.each([NaN, Infinity])('throws on a %p component instead of poisoning MMR', (bad) => {
    expect(() => cosine(Float32Array.from([bad, 0]), unit(1, 0))).toThrow(RangeError)
  })

  it('accepts ordinary float32 drift around unit norm', () => {
    // What a real vector looks like after a vec0 round trip.
    const drifted = Float32Array.from(unit(0.37, 0.93), (x) => x * 1.00002)
    expect(() => cosine(drifted, unit(1, 0))).not.toThrow()
  })
})
