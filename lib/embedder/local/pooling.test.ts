import { describe, expect, it } from 'vitest'

import { meanPoolAndNormalize } from './pooling'

function l2Norm(v: Float32Array): number {
  let sum = 0
  for (const x of v) sum += x * x
  return Math.sqrt(sum)
}

describe('meanPoolAndNormalize', () => {
  it('means only attended tokens then L2-normalizes to unit length', () => {
    // 3 tokens × 4 dims, row-major. Third row is masked out and must not count.
    const token0 = [1, 2, 3, 4] // attended
    const token1 = [3, 4, 5, 6] // attended
    const token2 = [100, 100, 100, 100] // masked — must be excluded
    const tokenEmbeddings = new Float32Array([...token0, ...token1, ...token2])
    const result = meanPoolAndNormalize(tokenEmbeddings, [1, 1, 0], 4)

    // Mean of the two attended rows is [2, 3, 4, 5]; normalize by its L2 norm.
    const mean = [2, 3, 4, 5]
    const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0))
    for (let d = 0; d < 4; d++) {
      expect(result[d]).toBeCloseTo(mean[d] / norm, 6)
    }
    expect(l2Norm(result)).toBeCloseTo(1, 6)
  })

  it('returns zeros (no NaN) when every token is masked', () => {
    const tokenEmbeddings = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8])
    const result = meanPoolAndNormalize(tokenEmbeddings, [0, 0], 4)

    expect(Array.from(result)).toEqual([0, 0, 0, 0])
  })

  it('normalizes a single attended token to unit length', () => {
    const tokenEmbeddings = new Float32Array([3, 0, 0, 4])
    const result = meanPoolAndNormalize(tokenEmbeddings, [1], 4)

    expect(result[0]).toBeCloseTo(0.6, 6)
    expect(result[1]).toBeCloseTo(0, 6)
    expect(result[2]).toBeCloseTo(0, 6)
    expect(result[3]).toBeCloseTo(0.8, 6)
    expect(l2Norm(result)).toBeCloseTo(1, 6)
  })

  it('returns zeros when the pooled vector is the zero vector', () => {
    const tokenEmbeddings = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0])
    const result = meanPoolAndNormalize(tokenEmbeddings, [1, 1], 4)

    expect(Array.from(result)).toEqual([0, 0, 0, 0])
  })
})
