import { describe, expect, it } from 'vitest'

import { distanceToCosine, knnQuery, unpackFloat32, vectorsByIdQuery } from './knn'
import { packFloat32 } from './ops'

const unit = (...xs: number[]): Float32Array => {
  const v = Float32Array.from(xs)
  const n = Math.hypot(...xs)
  return v.map((x) => x / n)
}

describe('distanceToCosine', () => {
  // Hand-computed against unit vectors, chosen to discriminate rather than to
  // be memorable — a squared-distance return would pass an ordering test but
  // fail these. See lessons-learned/known-answer-vectors-share-blind-spots.md.
  it('maps identical vectors (d = 0) to cosine 1', () => {
    expect(distanceToCosine(0)).toBeCloseTo(1, 6)
  })

  it('maps orthogonal unit vectors (d = sqrt(2)) to cosine 0', () => {
    expect(distanceToCosine(Math.SQRT2)).toBeCloseTo(0, 6)
  })

  it('maps 60-degree unit vectors (d = 1) to cosine 0.5', () => {
    expect(distanceToCosine(1)).toBeCloseTo(0.5, 6)
  })

  it('maps opposed unit vectors (d = 2) to cosine -1', () => {
    expect(distanceToCosine(2)).toBeCloseTo(-1, 6)
  })

  it('clamps a distance beyond the unit-norm range instead of returning < -1', () => {
    expect(distanceToCosine(3)).toBe(-1)
  })
})

describe('unpackFloat32', () => {
  it('round-trips through packFloat32', () => {
    const v = unit(1, 2, 3)
    expect(Array.from(unpackFloat32(packFloat32(v)))).toEqual(Array.from(v))
  })
})

describe('knnQuery', () => {
  it('binds MATCH, k, branch and model against the dim-suffixed table', () => {
    const q = knnQuery('lore', 384, {
      branchId: 'br_1',
      modelId: 'm',
      k: 200,
      vector: new Uint8Array(4),
    })
    expect(q.sql).toContain('FROM lore_vec_384')
    expect(q.sql).toContain('embedding MATCH ?')
    expect(q.sql).toContain('k = ?')
    expect(q.sql).toContain('branch_id = ?')
    expect(q.sql).toContain('model_id = ?')
    expect(q.params).toEqual([expect.any(Uint8Array), 200, 'br_1', 'm'])
  })
})

describe('vectorsByIdQuery', () => {
  it('returns an always-false predicate for an empty id set', () => {
    const q = vectorsByIdQuery('entity', 384, 'br_1', 'm', [])
    expect(q.sql).toContain('WHERE 0')
    expect(q.params).toEqual([])
  })

  it('binds one placeholder per id', () => {
    const q = vectorsByIdQuery('entity', 384, 'br_1', 'm', ['a', 'b'])
    expect(q.sql).toContain('id IN (?, ?)')
    expect(q.params).toEqual(['br_1', 'm', 'a', 'b'])
  })
})
