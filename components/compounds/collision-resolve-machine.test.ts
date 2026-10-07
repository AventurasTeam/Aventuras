import { describe, expect, it } from 'vitest'

import { initMergeState, mergeReducer, type MergeState } from './collision-resolve-machine'

describe('initMergeState', () => {
  it('starts on the default canonical, taking nothing from the other row and dropping no term', () => {
    expect(initMergeState('ent_a')).toEqual({
      canonicalId: 'ent_a',
      fromOther: new Set(),
      deselectedTags: [],
      deselectedKeywords: [],
    })
  })
})

describe('mergeReducer', () => {
  const initial = () => initMergeState('ent_a')

  describe('pick-canonical', () => {
    it('updates canonicalId', () => {
      const next = mergeReducer(initial(), { type: 'pick-canonical', id: 'ent_b' })
      expect(next.canonicalId).toBe('ent_b')
    })

    it('takes every field from the new canonical again, whatever was picked before', () => {
      const picked = mergeReducer(initial(), {
        type: 'pick-field',
        field: 'description',
        fromOther: true,
      })
      const next = mergeReducer(picked, { type: 'pick-canonical', id: 'ent_b' })
      expect(next.fromOther).toEqual(new Set())
    })

    it('preserves deselectedTags through a canonical flip', () => {
      const withDeselect = mergeReducer(initial(), { type: 'toggle-tag', tag: 'guard' })
      const next = mergeReducer(withDeselect, { type: 'pick-canonical', id: 'ent_b' })
      expect(next.deselectedTags).toEqual(['guard'])
    })
  })

  describe('pick-field', () => {
    it('takes one field from the other row without touching the others', () => {
      const status = mergeReducer(initial(), {
        type: 'pick-field',
        field: 'status',
        fromOther: true,
      })
      const next = mergeReducer(status, { type: 'pick-field', field: 'priority', fromOther: true })
      expect(next.fromOther).toEqual(new Set(['status', 'priority']))
    })

    it("gives a field back to the canonical's value", () => {
      const status = mergeReducer(initial(), {
        type: 'pick-field',
        field: 'status',
        fromOther: true,
      })
      const next = mergeReducer(status, { type: 'pick-field', field: 'status', fromOther: false })
      expect(next.fromOther).toEqual(new Set())
    })

    it('leaves the state it was given unchanged', () => {
      const status = mergeReducer(initial(), {
        type: 'pick-field',
        field: 'status',
        fromOther: true,
      })
      mergeReducer(status, { type: 'pick-field', field: 'priority', fromOther: true })
      expect(status.fromOther).toEqual(new Set(['status']))
    })

    it('preserves canonicalId', () => {
      const next = mergeReducer(initial(), { type: 'pick-field', field: 'status', fromOther: true })
      expect(next.canonicalId).toBe('ent_a')
    })
  })

  describe('toggle-tag', () => {
    it('adds a tag to deselectedTags', () => {
      const next = mergeReducer(initial(), { type: 'toggle-tag', tag: 'sword' })
      expect(next.deselectedTags).toEqual(['sword'])
    })

    it('removes a previously-deselected tag', () => {
      const after1 = mergeReducer(initial(), { type: 'toggle-tag', tag: 'sword' })
      const after2 = mergeReducer(after1, { type: 'toggle-tag', tag: 'sword' })
      expect(after2.deselectedTags).toEqual([])
    })

    it('accumulates multiple deselects', () => {
      const s1 = mergeReducer(initial(), { type: 'toggle-tag', tag: 'sword' })
      const s2 = mergeReducer(s1, { type: 'toggle-tag', tag: 'guard' })
      expect(new Set(s2.deselectedTags)).toEqual(new Set(['sword', 'guard']))
    })
  })

  describe('reset', () => {
    it('re-initializes state for new entities', () => {
      const dirty: MergeState = {
        canonicalId: 'ent_b',
        fromOther: new Set(['description']),
        deselectedTags: ['sword'],
        deselectedKeywords: ['the wanderer'],
      }
      expect(mergeReducer(dirty, { type: 'reset', defaultCanonicalId: 'ent_c' })).toEqual(
        initMergeState('ent_c'),
      )
    })
  })
})

describe('keyword deselection', () => {
  const start = (): MergeState => initMergeState('ent_a')

  it('toggles a keyword in and out of the deselected set', () => {
    const after = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    expect(after.deselectedKeywords).toEqual(['the grey wolf'])
    expect(
      mergeReducer(after, { type: 'toggle-keyword', keyword: 'the grey wolf' }).deselectedKeywords,
    ).toEqual([])
  })

  // A chip's spelling changes with the canonical; the deselect follows the keyword.
  it('tracks a keyword under its normalized form, whatever the spelling toggled', () => {
    const after = mergeReducer(start(), { type: 'toggle-keyword', keyword: ' The Grey Wolf ' })
    expect(after.deselectedKeywords).toEqual(['the grey wolf'])
    expect(
      mergeReducer(after, { type: 'toggle-keyword', keyword: 'THE GREY WOLF' }).deselectedKeywords,
    ).toEqual([])
  })

  // Same contract deselectedTags has: keyword choices are independent of the pick.
  it('preserves deselected keywords across a canonical re-pick', () => {
    const deselected = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    const after = mergeReducer(deselected, { type: 'pick-canonical', id: 'ent_b' })
    expect(after.deselectedKeywords).toEqual(['the grey wolf'])
  })

  // The two deselect sets must not share storage — toggling one would strike the other's chip.
  it('keeps the tag and keyword deselect sets apart', () => {
    const after = mergeReducer(start(), { type: 'toggle-keyword', keyword: 'the grey wolf' })
    expect(after.deselectedTags).toEqual([])
  })
})
