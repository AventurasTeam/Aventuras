/**
 * Pack binding: matching a story's recorded pack to a local one, and carrying the story's
 * per-entity values across when the binding moves.
 *
 * The properties worth pinning are the ones that lose user data when they break: a name-only
 * match must never read as certain, and a remap must never drop a key.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PresetPack, RuntimeVarsMap } from './types'

const db = { packs: [] as PresetPack[] }

vi.mock('$lib/services/database', () => ({
  database: { getAllPacks: vi.fn(async () => db.packs) },
}))

const { matchPack, remapRuntimeVars } = await import('./binding')

function pack(overrides: Partial<PresetPack>): PresetPack {
  return {
    id: 'p1',
    name: 'Grimdark',
    description: null,
    author: 'Ada',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  db.packs = []
})

describe('matchPack', () => {
  it('matches on name and author, ignoring case and surrounding space', () => {
    db.packs = [pack({ id: 'local-1' })]
    return expect(matchPack({ name: '  grimdark ', author: 'ADA' })).resolves.toEqual({
      pack: db.packs[0],
      confidence: 'exact',
    })
  })

  it('reports a name hit with a different author as name-only, not exact', async () => {
    // UNIQUE(name) means there is exactly one candidate, which says the match is unambiguous,
    // not that it is the right pack. Binding silently here narrates the story through a
    // stranger's templates.
    db.packs = [pack({ id: 'local-1', author: 'Grace' })]

    const match = await matchPack({ name: 'Grimdark', author: 'Ada' })

    expect(match.confidence).toBe('name-only')
    expect(match.pack?.id).toBe('local-1')
  })

  it('treats a null author and an empty one as the same value', async () => {
    db.packs = [pack({ id: 'local-1', author: null })]
    await expect(matchPack({ name: 'Grimdark', author: '' })).resolves.toMatchObject({
      confidence: 'exact',
    })
    await expect(matchPack({ name: 'Grimdark', author: null })).resolves.toMatchObject({
      confidence: 'exact',
    })
  })

  it('asserts nothing when no local pack carries the name', async () => {
    db.packs = [pack({ id: 'local-1', name: 'Cosy' })]
    await expect(matchPack({ name: 'Grimdark', author: 'Ada' })).resolves.toEqual({
      pack: null,
      confidence: 'none',
    })
  })

  it('asserts nothing for a file with no usable pack identity', async () => {
    db.packs = [pack({})]
    await expect(matchPack(null)).resolves.toEqual({ pack: null, confidence: 'none' })
    await expect(matchPack({ name: '   ', author: null })).resolves.toEqual({
      pack: null,
      confidence: 'none',
    })
  })

  it('uses a caller-supplied pack list rather than loading one', async () => {
    db.packs = [pack({ id: 'from-db' })]
    const match = await matchPack({ name: 'Grimdark', author: 'Ada' }, [pack({ id: 'passed-in' })])
    expect(match.pack?.id).toBe('passed-in')
  })
})

describe('remapRuntimeVars', () => {
  const sourceDefs = [
    { entityType: 'character' as const, variableName: 'morale' },
    { entityType: 'character' as const, variableName: 'secret' },
  ]
  const targetDefs = [
    { id: 'local-morale', entityType: 'character' as const, variableName: 'morale' },
  ]

  function metadataWith(runtimeVars: RuntimeVarsMap) {
    return { runtimeVars, notes: 'kept' }
  }

  it('adds the local key while keeping the source key', () => {
    const metadata = metadataWith({ 'src-morale': { variableName: 'morale', v: 7 } })

    const result = remapRuntimeVars(metadata, 'character', sourceDefs, targetDefs)

    expect(result.runtimeVars).toEqual({
      'src-morale': { variableName: 'morale', v: 7 },
      'local-morale': { variableName: 'morale', v: 7 },
    })
    expect(result.notes).toBe('kept')
  })

  it('keeps a value whose name the target pack does not define, and adds no key for it', () => {
    const metadata = metadataWith({
      'src-morale': { variableName: 'morale', v: 7 },
      'src-secret': { variableName: 'secret', v: 'hidden' },
    })

    const result = remapRuntimeVars(metadata, 'character', sourceDefs, targetDefs)

    expect(result.runtimeVars).toEqual({
      'src-morale': { variableName: 'morale', v: 7 },
      'src-secret': { variableName: 'secret', v: 'hidden' },
      'local-morale': { variableName: 'morale', v: 7 },
    })
  })

  it('makes the original values readable again when the story is re-bound to the source pack', () => {
    // The round trip the spec requires: A -> B -> A must present what A presented, which only
    // holds because the first remap left A's key alone.
    const packA = [{ id: 'a-morale', entityType: 'character' as const, variableName: 'morale' }]
    const packB = [{ id: 'b-morale', entityType: 'character' as const, variableName: 'morale' }]
    const start = metadataWith({ 'a-morale': { variableName: 'morale', v: 7 } })

    const onB = remapRuntimeVars(start, 'character', sourceDefs, packB)
    const backOnA = remapRuntimeVars(onB, 'character', sourceDefs, packA)

    expect((backOnA.runtimeVars as RuntimeVarsMap)['a-morale']).toEqual({
      variableName: 'morale',
      v: 7,
    })
    expect((backOnA.runtimeVars as RuntimeVarsMap)['b-morale']).toEqual({
      variableName: 'morale',
      v: 7,
    })
  })

  it('does not re-key a value onto a definition for a different entity type', () => {
    const locationDefs = [
      { id: 'local-loc-morale', entityType: 'location' as const, variableName: 'morale' },
    ]
    const metadata = metadataWith({ 'src-morale': { variableName: 'morale', v: 7 } })

    const result = remapRuntimeVars(metadata, 'character', sourceDefs, locationDefs)

    expect(result.runtimeVars).toEqual({ 'src-morale': { variableName: 'morale', v: 7 } })
  })

  it.each([
    ['there are no source definitions', undefined, targetDefs],
    ['there are no target definitions', sourceDefs, undefined],
  ])('returns the metadata untouched when %s', (_label, source, target) => {
    const metadata = metadataWith({ 'src-morale': { variableName: 'morale', v: 7 } })
    expect(remapRuntimeVars(metadata, 'character', source, target)).toBe(metadata)
  })

  it('returns the metadata untouched when the entity holds no values', () => {
    const metadata = { runtimeVars: {} }
    expect(remapRuntimeVars(metadata, 'character', sourceDefs, targetDefs)).toBe(metadata)
    expect(remapRuntimeVars(null, 'character', sourceDefs, targetDefs)).toBeNull()
  })

  it('returns the metadata untouched when nothing in it matches', () => {
    const metadata = metadataWith({ 'src-secret': { variableName: 'secret', v: 'hidden' } })
    expect(remapRuntimeVars(metadata, 'character', sourceDefs, targetDefs)).toBe(metadata)
  })
})
