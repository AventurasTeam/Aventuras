import { describe, expect, it, vi } from 'vitest'

import { cosine, reconcileNewCharacter, TAU_HIGH, TAU_LOW } from './reconcile'

const entity = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'char_1',
    branchId: 'branch_1',
    kind: 'character',
    name: 'Eldrin',
    description: 'A tavern keeper with ink-stained hands.',
    status: 'staged',
    ...over,
  }) as never

// Deterministic stub embedder: identical text -> identical vector; similarity is
// driven by the caller's script, not by a real model.
function stubEmbedder(similarity: number) {
  return vi.fn(async () => ({
    vectors: [
      new Float32Array([1, 0]),
      new Float32Array([similarity, Math.sqrt(1 - similarity ** 2)]),
    ],
    dim: 2,
  }))
}

describe('reconcileNewCharacter', () => {
  it('creates fresh when no name matches', async () => {
    const embed = stubEmbedder(0.99)
    const decision = await reconcileNewCharacter(
      { name: 'Morwen', description: 'A queen in exile.' },
      { entities: [entity()], embedDescriptions: embed },
    )
    expect(decision).toEqual({ kind: 'create', flagged: false })
    expect(embed).not.toHaveBeenCalled()
  })

  it('promotes a staged namesake on high similarity', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper, ink on his hands.' },
      { entities: [entity()], embedDescriptions: stubEmbedder(0.9) },
    )
    expect(decision).toEqual({ kind: 'promote', entityId: 'char_1', similarity: 0.9 })
  })

  it('treats an already-active namesake as a known mention, not a promotion', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper, ink on his hands.' },
      { entities: [entity({ status: 'active' })], embedDescriptions: stubEmbedder(0.9) },
    )
    expect(decision).toEqual({ kind: 'known', entityId: 'char_1', similarity: 0.9 })
  })

  it('creates flagged on low similarity, and says why', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'A dragon the size of a barn.' },
      { entities: [entity()], embedDescriptions: stubEmbedder(0.1) },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: 0.1,
      flagReason: 'distinct',
    })
  })

  it('creates flagged in the ambiguous band, distinguished from the low band', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'A merchant, perhaps the keeper?' },
      { entities: [entity()], embedDescriptions: stubEmbedder(0.6) },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: 0.6,
      flagReason: 'ambiguous',
    })
  })

  it('matches names case- and whitespace-insensitively', async () => {
    const decision = await reconcileNewCharacter(
      { name: '  eldrin ', description: 'The tavern keeper.' },
      { entities: [entity()], embedDescriptions: stubEmbedder(0.9) },
    )
    expect(decision.kind).toBe('promote')
  })

  it('creates flagged when the embedder is unavailable', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      {
        entities: [entity()],
        embedDescriptions: async () => {
          throw new Error('embedder offline')
        },
      },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: null,
      flagReason: 'no-signal',
    })
  })

  it('considers retired namesakes too', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      { entities: [entity({ status: 'retired' })], embedDescriptions: stubEmbedder(0.9) },
    )
    expect(decision).toEqual({ kind: 'known', entityId: 'char_1', similarity: 0.9 })
  })
})

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal ones', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
  })
})

describe('thresholds', () => {
  it('pins the canon starting ranges', () => {
    expect([TAU_LOW, TAU_HIGH]).toEqual([0.5, 0.75])
  })
})
