import { describe, expect, it } from 'vitest'

import { computeDivergence, type EntitySummary } from './collision-resolve-diff'
import { initMergeState, mergeReducer, type MergeState } from './collision-resolve-machine'

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
    priority: 0,
    tags: ['hero', 'sword'],
    keywords: [],
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

describe('initMergeState', () => {
  it('sets canonicalId to defaultCanonicalId', () => {
    const a = baseEntity()
    const b = baseEntity({ id: 'ent_b', description: 'Different' })
    const state = initMergeState(computeDivergence(a, b), a.id, a.id)
    expect(state.canonicalId).toBe('ent_a')
  })

  it('initializes deselectedTags as empty', () => {
    const a = baseEntity()
    const b = baseEntity({ id: 'ent_b', tags: ['guard'] })
    const state = initMergeState(computeDivergence(a, b), a.id, a.id)
    expect(state.deselectedTags).toEqual([])
  })

  it('initializes fieldChoices to A for each divergent scalar when canonical=A', () => {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'B desc', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), a.id, a.id)
    expect(state.fieldChoices.description).toBe('A')
    expect(state.fieldChoices.status).toBe('A')
  })

  it('initializes fieldChoices to B for each divergent scalar when canonical=B', () => {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'B desc', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), b.id, a.id)
    expect(state.fieldChoices.description).toBe('B')
    expect(state.fieldChoices.status).toBe('B')
  })

  it('omits non-divergent fields from fieldChoices', () => {
    const a = baseEntity({ description: 'same', status: 'active' })
    const b = baseEntity({ id: 'ent_b', description: 'same', status: 'retired' })
    const state = initMergeState(computeDivergence(a, b), a.id, a.id)
    expect(state.fieldChoices).toEqual({ status: 'A' })
  })
})

describe('mergeReducer', () => {
  function setup() {
    const a = baseEntity({ description: 'A desc', status: 'active' })
    const b = baseEntity({
      id: 'ent_b',
      description: 'B desc',
      status: 'retired',
      tags: ['guard', 'sword'],
    })
    const diff = computeDivergence(a, b)
    const initial = initMergeState(diff, a.id, a.id)
    return { a, b, diff, initial }
  }

  describe('pick-canonical', () => {
    it('updates canonicalId', () => {
      const { initial, a } = setup()
      const next = mergeReducer(initial, { type: 'pick-canonical', id: 'ent_b', entityAId: a.id })
      expect(next.canonicalId).toBe('ent_b')
    })

    it('rebases all fieldChoices to the new canonical side', () => {
      const { initial, a } = setup()
      const next = mergeReducer(initial, { type: 'pick-canonical', id: 'ent_b', entityAId: a.id })
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('B')
    })

    it('rebases ALL fields even when one was overridden first', () => {
      // Regression: a previous draft derived "new side" from the
      // first field's current choice, which is wrong once
      // pick-field has overridden a field independently.
      const { initial, a } = setup()
      const overridden = mergeReducer(initial, {
        type: 'pick-field',
        field: 'description',
        side: 'B',
      })
      // Now choices = { description: 'B', status: 'A' }, canonical still 'A'
      const next = mergeReducer(overridden, {
        type: 'pick-canonical',
        id: 'ent_b',
        entityAId: a.id,
      })
      // After flipping canonical to B, both must be 'B' — the
      // canonical-pick is destructive to prior pick-field choices.
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('B')
    })

    it('preserves deselectedTags through a canonical flip', () => {
      const { initial, a } = setup()
      const withDeselect = mergeReducer(initial, { type: 'toggle-tag', tag: 'guard' })
      const next = mergeReducer(withDeselect, {
        type: 'pick-canonical',
        id: 'ent_b',
        entityAId: a.id,
      })
      expect(next.deselectedTags).toEqual(['guard'])
    })
  })

  describe('pick-field', () => {
    it('overrides one field without touching others', () => {
      const { initial } = setup()
      // canonical is A so both choices init to 'A'
      const next = mergeReducer(initial, {
        type: 'pick-field',
        field: 'description',
        side: 'B',
      })
      expect(next.fieldChoices.description).toBe('B')
      expect(next.fieldChoices.status).toBe('A')
    })

    it('preserves canonicalId', () => {
      const { initial } = setup()
      const next = mergeReducer(initial, {
        type: 'pick-field',
        field: 'status',
        side: 'B',
      })
      expect(next.canonicalId).toBe(initial.canonicalId)
    })
  })

  describe('toggle-tag', () => {
    it('adds a tag to deselectedTags', () => {
      const { initial } = setup()
      const next = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      expect(next.deselectedTags).toEqual(['sword'])
    })

    it('removes a previously-deselected tag', () => {
      const { initial } = setup()
      const after1 = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      const after2 = mergeReducer(after1, { type: 'toggle-tag', tag: 'sword' })
      expect(after2.deselectedTags).toEqual([])
    })

    it('accumulates multiple deselects', () => {
      const { initial } = setup()
      const s1 = mergeReducer(initial, { type: 'toggle-tag', tag: 'sword' })
      const s2 = mergeReducer(s1, { type: 'toggle-tag', tag: 'guard' })
      expect(new Set(s2.deselectedTags)).toEqual(new Set(['sword', 'guard']))
    })
  })

  describe('reset', () => {
    it('re-initializes state for new entities', () => {
      const { initial } = setup()
      const dirty: MergeState = {
        ...initial,
        canonicalId: 'ent_b',
        deselectedTags: ['sword'],
      }
      const newA = baseEntity({ id: 'ent_c', description: 'C' })
      const newB = baseEntity({ id: 'ent_d', description: 'D' })
      const newDiff = computeDivergence(newA, newB)
      const next = mergeReducer(dirty, {
        type: 'reset',
        diff: newDiff,
        defaultCanonicalId: newA.id,
        entityAId: newA.id,
      })
      expect(next.canonicalId).toBe('ent_c')
      expect(next.deselectedTags).toEqual([])
      expect(next.fieldChoices.description).toBe('A')
    })
  })
})

describe('keyword deselection', () => {
  const start = (): MergeState => {
    const a = baseEntity({ keywords: ['the grey wolf'] })
    const b = baseEntity({ id: 'ent_b', keywords: ['the innkeeper'] })
    return initMergeState(computeDivergence(a, b), a.id, a.id)
  }

  it('toggles a keyword in and out of the deselected set', () => {
    const after = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    expect(after.deselectedKeywords).toEqual(['the grey wolf'])
    expect(
      mergeReducer(after, { type: 'toggle-keyword', keyword: 'the grey wolf' }).deselectedKeywords,
    ).toEqual([])
  })

  // Same contract deselectedTags has: keyword choices are independent of the pick.
  it('preserves deselected keywords across a canonical re-pick', () => {
    const deselected = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    const after = mergeReducer(deselected, {
      type: 'pick-canonical',
      id: 'ent_b',
      entityAId: 'ent_a',
    })
    expect(after.deselectedKeywords).toEqual(['the grey wolf'])
  })

  // The two deselect sets must not share storage: toggling one would otherwise
  // strike the other's chip in the dialog.
  it('keeps the tag and keyword deselect sets apart', () => {
    const after = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    expect(after.deselectedTags).toEqual([])
  })
})
