import { describe, expect, it } from 'vitest'

import { IdBiMap } from './bimap'

const charA = 'char_0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const charB = 'char_1a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const locA = 'loc_2a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const loreA = 'lore_3a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const entryA = 'entry_4a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

describe('IdBiMap', () => {
  it('allocates per-kind counters from kind prefixes', () => {
    const m = new IdBiMap()
    expect(m.allocate(charA)).toBe('c1')
    expect(m.allocate(charB)).toBe('c2')
    expect(m.allocate(locA)).toBe('l1')
    expect(m.allocate(loreA)).toBe('lo1')
  })

  it('returns the same placeholder for a repeated uuid', () => {
    const m = new IdBiMap()
    expect(m.allocate(charA)).toBe('c1')
    expect(m.allocate(charA)).toBe('c1')
    expect(m.allocate(charB)).toBe('c2')
  })

  it('resolves both directions', () => {
    const m = new IdBiMap()
    const p = m.allocate(charA)
    expect(m.getPlaceholderFor(charA)).toBe(p)
    expect(m.getUuidFor(p)).toBe(charA)
    expect(m.getPlaceholderFor('char_unknown')).toBeUndefined()
    expect(m.getUuidFor('c9')).toBeUndefined()
  })

  it('does not share state between two maps', () => {
    const a = new IdBiMap()
    const b = new IdBiMap()
    a.allocate(charA)
    expect(b.getPlaceholderFor(charA)).toBeUndefined()
    expect(b.allocate(charB)).toBe('c1')
  })

  it('rejects allocation of a non-substitutable or malformed id', () => {
    const m = new IdBiMap()
    expect(() => m.allocate(entryA)).toThrow(TypeError)
    expect(() => m.allocate('char_not-a-uuid')).toThrow(TypeError)
  })

  it('registers a consumer-chosen handle to a uuid', () => {
    const m = new IdBiMap()
    m.registerHandle('newHero', charA)
    expect(m.getUuidFor('newHero')).toBe(charA)
    // Reverse-only by design: the forward map carries allocated placeholders, not handles.
    expect(m.getPlaceholderFor(charA)).toBeUndefined()
  })

  it('allows idempotent handle registration but rejects a conflicting one', () => {
    const m = new IdBiMap()
    m.registerHandle('newHero', charA)
    m.registerHandle('newHero', charA)
    expect(m.getUuidFor('newHero')).toBe(charA)
    expect(() => m.registerHandle('newHero', charB)).toThrow()
    expect(() => m.registerHandle(m.allocate(locA), charB)).toThrow()
  })
})
