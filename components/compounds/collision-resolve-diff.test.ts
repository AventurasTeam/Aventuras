import { describe, expect, it } from 'vitest'

import { computeDivergence, mergeChips, type EntitySummary } from './collision-resolve-diff'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_a',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'auto',
    priority: 0,
    tags: ['hero', 'sword'],
    keywords: [],
    state: { hp: 100 },
    relationCounts: {
      awarenessRows: 0,
      involvements: 0,
      relationships: 0,
      joiningRelationship: false,
      inverseRefs: 0,
      embeddings: 1,
      translationRows: 0,
      unheldItems: 0,
      overlap: {
        awareness: 0,
        involvements: 0,
        relationships: 0,
        holdersLosingItem: 0,
        canonicalRefs: 0,
      },
    },
    ...overrides,
  }
}

describe('computeDivergence', () => {
  describe('scalars', () => {
    it('returns empty divergentScalars when all match', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual([])
    })

    it('detects single divergent scalar', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b', description: 'A city guardsman.' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual(['description'])
    })

    it('detects multiple divergent scalars in fixed order', () => {
      const a = baseEntity()
      const b = baseEntity({
        id: 'ent_b',
        name: 'Kael the Bold',
        description: 'A city guardsman.',
        status: 'retired',
      })
      const diff = computeDivergence(a, b)
      // Order matches SCALAR_FIELDS, not input order
      expect(diff.divergentScalars).toEqual(['name', 'description', 'status'])
    })

    it('places priority last in the fixed order', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b', name: 'Kael II', injectionMode: 'always', priority: 4 })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual(['name', 'injectionMode', 'priority'])
    })

    // world.md → Merge lists priority among the per-row radio scalars.
    it('reports a priority-only divergence as exactly one divergent scalar', () => {
      const diff = computeDivergence(
        baseEntity({ priority: 0 }),
        baseEntity({ id: 'ent_b', priority: 9 }),
      )
      expect(diff.divergentScalars).toEqual(['priority'])
    })

    it('treats undefined description as divergent from a string', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b', description: undefined })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toContain('description')
    })

    it('treats two undefined retiredReasons as matching', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).not.toContain('retiredReason')
    })
  })

  describe('tags', () => {
    it('returns null when tag sets are identical (order-insensitive)', () => {
      const a = baseEntity({ tags: ['hero', 'sword'] })
      const b = baseEntity({ id: 'ent_b', tags: ['sword', 'hero'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toBeNull()
    })

    it('returns null when both tag sets are empty', () => {
      const a = baseEntity({ tags: [] })
      const b = baseEntity({ id: 'ent_b', tags: [] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toBeNull()
    })

    it('partitions onlyInA / onlyInB / both', () => {
      const a = baseEntity({ tags: ['hero', 'sword', 'noble'] })
      const b = baseEntity({ id: 'ent_b', tags: ['sword', 'guard'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toEqual({
        onlyInA: ['hero', 'noble'],
        onlyInB: ['guard'],
        both: ['sword'],
      })
    })

    it('returns null when the sides differ only in whitespace and blanks', () => {
      const a = baseEntity({ tags: ['hero', ' '] })
      const b = baseEntity({ id: 'ent_b', tags: ['hero '] })
      expect(computeDivergence(a, b).tags).toBeNull()
    })

    it('keeps tags exact: a case variant tag diverges', () => {
      const a = baseEntity({ tags: ['Hero'] })
      const b = baseEntity({ id: 'ent_b', tags: ['hero'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toEqual({ onlyInA: ['Hero'], onlyInB: ['hero'], both: [] })
    })

    it('sorts each partition alphabetically', () => {
      const a = baseEntity({ tags: ['zebra', 'apple'] })
      const b = baseEntity({ id: 'ent_b', tags: ['mango', 'banana'] })
      const diff = computeDivergence(a, b)
      expect(diff.tags).toEqual({
        onlyInA: ['apple', 'zebra'],
        onlyInB: ['banana', 'mango'],
        both: [],
      })
    })
  })

  describe('state', () => {
    it('returns false when state objects deep-equal', () => {
      const a = baseEntity({ state: { hp: 100, mp: 50 } })
      const b = baseEntity({ id: 'ent_b', state: { mp: 50, hp: 100 } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(false)
    })

    it('returns true when scalars in state differ', () => {
      const a = baseEntity({ state: { hp: 100 } })
      const b = baseEntity({ id: 'ent_b', state: { hp: 80 } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns true when nested objects differ', () => {
      const a = baseEntity({ state: { stats: { str: 10 } } })
      const b = baseEntity({ id: 'ent_b', state: { stats: { str: 12 } } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns true when arrays differ', () => {
      const a = baseEntity({ state: { inventory: ['sword', 'shield'] } })
      const b = baseEntity({ id: 'ent_b', state: { inventory: ['sword'] } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('treats missing key as different from explicit undefined', () => {
      const a = baseEntity({ state: { hp: 100 } })
      const b = baseEntity({ id: 'ent_b', state: { hp: 100, mp: undefined } })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(true)
    })

    it('returns false when both states are empty', () => {
      const a = baseEntity({ state: {} })
      const b = baseEntity({ id: 'ent_b', state: {} })
      const diff = computeDivergence(a, b)
      expect(diff.stateDivergent).toBe(false)
    })
  })

  describe('combined', () => {
    it('reports all dimensions diverging at once', () => {
      const a = baseEntity({
        description: 'A',
        tags: ['x'],
        state: { hp: 100 },
      })
      const b = baseEntity({
        id: 'ent_b',
        description: 'B',
        tags: ['y'],
        state: { hp: 80 },
      })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual(['description'])
      expect(diff.tags).toEqual({ onlyInA: ['x'], onlyInB: ['y'], both: [] })
      expect(diff.stateDivergent).toBe(true)
    })

    it('reports truly identical entities cleanly', () => {
      const a = baseEntity()
      const b = baseEntity({ id: 'ent_b' })
      const diff = computeDivergence(a, b)
      expect(diff.divergentScalars).toEqual([])
      expect(diff.tags).toBeNull()
      expect(diff.stateDivergent).toBe(false)
    })
  })
})

describe('keywords', () => {
  // Keywords are retrieval-targeted: canonical-only silently narrows what the merge can match.
  it('partitions keywords the way it partitions tags', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['the grey wolf', 'shared'] }),
      baseEntity({ id: 'ent_b', keywords: ['the innkeeper', 'shared'] }),
    )
    expect(diff.keywords).toEqual({
      onlyInA: ['the grey wolf'],
      onlyInB: ['the innkeeper'],
      both: ['shared'],
    })
  })

  it('nulls the keyword channel when both sides carry the same set', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['a'] }),
      baseEntity({ id: 'ent_b', keywords: ['a'] }),
    )
    expect(diff.keywords).toBeNull()
  })

  // Independent channels: a shared partition call would let diverging tags invent a keyword row.
  it('keeps the tag and keyword channels independent', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['a'], tags: ['x'] }),
      baseEntity({ id: 'ent_b', keywords: ['a'], tags: ['y'] }),
    )
    expect(diff.keywords).toBeNull()
    expect(diff.tags).not.toBeNull()
  })

  it('treats a case or spacing variant as the same keyword', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['The Wanderer'] }),
      baseEntity({ id: 'ent_b', keywords: [' the wanderer'] }),
    )
    expect(diff.keywords).toBeNull()
  })

  it("shows a shared keyword in A's spelling and each side's own in its first spelling", () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['Sword', 'sword', 'gate'] }),
      baseEntity({ id: 'ent_b', keywords: ['SWORD', 'inn', 'Inn'] }),
    )
    expect(diff.keywords).toEqual({ onlyInA: ['gate'], onlyInB: ['inn'], both: ['Sword'] })
  })

  it('ignores blank keywords', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['a', '  '] }),
      baseEntity({ id: 'ent_b', keywords: ['a'] }),
    )
    expect(diff.keywords).toBeNull()
  })

  it('shows a stored keyword trimmed, as the merge writes it', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: [' courier', 'Sword'] }),
      baseEntity({ id: 'ent_b', keywords: ['alpha', 'sword'] }),
    )
    expect(diff.keywords).toEqual({ onlyInA: ['courier'], onlyInB: ['alpha'], both: ['Sword'] })
  })

  it('sorts each keyword partition alphabetically', () => {
    const diff = computeDivergence(
      baseEntity({ keywords: ['zebra', 'apple', 'Yak', 'Cat'] }),
      baseEntity({ id: 'ent_b', keywords: ['mango', 'banana', 'yak', 'cat'] }),
    )
    expect(diff.keywords).toEqual({
      onlyInA: ['apple', 'zebra'],
      onlyInB: ['banana', 'mango'],
      both: ['Cat', 'Yak'],
    })
  })
})

describe('mergeChips', () => {
  const chipsFor = (a: EntitySummary, b: EntitySummary, canonical: EntitySummary) =>
    mergeChips(computeDivergence(a, b), canonical, canonical === a ? b : a)

  it("offers the canonical's terms in stored order, then the other row's additions sorted", () => {
    const a = baseEntity({ tags: ['sword', 'hero'], keywords: ['the wanderer', 'Kael'] })
    const b = baseEntity({
      id: 'ent_b',
      tags: ['zeta', 'hero', 'alpha'],
      keywords: ['the gate guard', 'Amber'],
    })
    expect(chipsFor(a, b, a)).toEqual({
      tags: ['sword', 'hero', 'alpha', 'zeta'],
      keywords: ['the wanderer', 'Kael', 'Amber', 'the gate guard'],
    })
    expect(chipsFor(a, b, b)).toEqual({
      tags: ['zeta', 'hero', 'alpha', 'sword'],
      keywords: ['the gate guard', 'Amber', 'Kael', 'the wanderer'],
    })
  })

  it("offers a shared keyword once, in the canonical's spelling", () => {
    const a = baseEntity({ keywords: ['The Swordsman', 'the wanderer'] })
    const b = baseEntity({ id: 'ent_b', keywords: ['THE SWORDSMAN', 'the gate guard'] })
    expect(chipsFor(a, b, b).keywords).toEqual(['THE SWORDSMAN', 'the gate guard', 'the wanderer'])
  })

  it('offers no chips for a list the two rows agree on', () => {
    const a = baseEntity({ tags: ['hero', 'sword'], keywords: ['the wanderer'] })
    const b = baseEntity({ id: 'ent_b', tags: ['sword', 'hero'], keywords: ['The Wanderer'] })
    expect(chipsFor(a, b, a)).toEqual({ tags: [], keywords: [] })
  })

  it('judges each list on its own', () => {
    const a = baseEntity({ tags: ['hero'], keywords: ['the wanderer'] })
    const b = baseEntity({ id: 'ent_b', tags: ['hero'], keywords: ['the gate guard'] })
    expect(chipsFor(a, b, a)).toEqual({ tags: [], keywords: ['the wanderer', 'the gate guard'] })
  })
})
