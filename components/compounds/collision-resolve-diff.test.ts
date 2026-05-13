import { describe, expect, it } from 'vitest'

import { computeDivergence, type EntitySummary } from './collision-resolve-diff'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_a',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'on-relevance',
    tags: ['hero', 'sword'],
    state: { hp: 100 },
    relationCounts: {
      awarenessRows: 0,
      involvements: 0,
      inverseRefs: 0,
      embeddings: 1,
      translationRows: 0,
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
