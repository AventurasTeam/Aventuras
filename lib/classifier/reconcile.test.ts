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

  it('promotes exactly at TAU_HIGH', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      { entities: [entity()], embedDescriptions: stubEmbedder(TAU_HIGH) },
    )
    expect(decision).toEqual({ kind: 'promote', entityId: 'char_1', similarity: TAU_HIGH })
  })

  it('treats exactly TAU_LOW as ambiguous, not distinct', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      { entities: [entity()], embedDescriptions: stubEmbedder(TAU_LOW) },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: TAU_LOW,
      flagReason: 'ambiguous',
    })
  })

  it('creates flagged as no-signal when the embedder returns the wrong vector count', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      {
        entities: [entity()],
        embedDescriptions: async () => ({ vectors: [new Float32Array([1, 0])], dim: 2 }),
      },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: null,
      flagReason: 'no-signal',
    })
  })

  it('treats a null namesake description as empty', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      { entities: [entity({ description: null })], embedDescriptions: stubEmbedder(0.9) },
    )
    expect(decision).toEqual({ kind: 'promote', entityId: 'char_1', similarity: 0.9 })
  })

  // Create-with-flag deliberately leaves two rows sharing a name, so from the
  // next pass on "the namesake" is ambiguous. Scoring only the first would let
  // insertion order decide whether a real match is found at all.
  it('scores every namesake and settles on the best match, not the first', async () => {
    const embed = vi.fn(async (texts: string[]) => ({
      vectors: [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]), // decoy, similarity 0
        new Float32Array([1, 0]), // true match
      ].slice(0, texts.length),
      dim: 2,
    }))
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      {
        entities: [
          entity({ id: 'char_decoy', description: 'A blacksmith.' }),
          entity({ id: 'char_real', description: 'A tavern keeper with ink-stained hands.' }),
        ],
        embedDescriptions: embed,
      },
    )
    expect(decision).toMatchObject({ kind: 'promote', entityId: 'char_real' })
    // One call carrying the candidate plus both namesakes.
    expect(embed.mock.calls[0][0]).toHaveLength(3)
  })

  // Mid embedder-swap the two sides can come back on different models. Comparing
  // the shared prefix would fabricate a similarity and drive a create-or-merge.
  it('degrades to no-signal when the vectors disagree on dimension', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      {
        entities: [entity()],
        embedDescriptions: vi.fn(async () => ({
          vectors: [new Float32Array([1, 0, 0]), new Float32Array([1, 0])],
          dim: 3,
        })),
      },
    )
    expect(decision).toEqual({
      kind: 'create',
      flagged: true,
      similarity: null,
      flagReason: 'no-signal',
    })
  })

  it('degrades to no-signal on a short vector set', async () => {
    const decision = await reconcileNewCharacter(
      { name: 'Eldrin', description: 'The tavern keeper.' },
      {
        entities: [entity({ id: 'char_a' }), entity({ id: 'char_b' })],
        embedDescriptions: vi.fn(async () => ({
          vectors: [new Float32Array([1, 0]), new Float32Array([1, 0])],
          dim: 2,
        })),
      },
    )
    expect(decision).toMatchObject({ flagReason: 'no-signal' })
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
