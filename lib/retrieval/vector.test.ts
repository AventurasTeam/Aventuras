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
})
