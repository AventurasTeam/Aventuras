import { describe, it, expect } from 'vitest'
import { mergeArrayLists, composePendingOnto, mergeIntent } from './vaultMerge'

describe('mergeArrayLists', () => {
  it('appends genuinely new items', () => {
    expect(mergeArrayLists(['a', 'b'], ['a'], ['a'])).toEqual(['a', 'b'])
  })

  it('does not duplicate an appended item that is already present in baseArr', () => {
    // This is the scenario that produced doubling/tripling tags in the vault
    // assistant: two sibling pending changes both diff their own `data` against
    // the same stale `previous` (neither has been approved yet), so each one
    // independently looks like "add b" — but baseArr already has it from an
    // earlier sibling in the same composition pass.
    expect(mergeArrayLists(['a', 'b'], ['a'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('still removes an item that disappeared between previous and data', () => {
    expect(mergeArrayLists(['a'], ['a', 'b'], ['a', 'b'])).toEqual(['a'])
  })

  it('removes only one copy of a duplicated value (multiset semantics)', () => {
    expect(mergeArrayLists(['John'], ['John', 'John'], ['John', 'John'])).toEqual(['John'])
  })

  it('still applies a genuine positional replacement', () => {
    expect(mergeArrayLists(['a', 'z'], ['a', 'b'], ['a', 'b'])).toEqual(['a', 'z'])
  })

  it('preserves an intentional duplicate addition even if the value already exists in the base', () => {
    // `data` explicitly has two copies of 'x': one was already in previous/base,
    // the second is a genuine new addition, not an artifact of composing
    // sibling changes. The base-count subtraction must not eat this one.
    expect(mergeArrayLists(['x', 'x'], ['x'], ['x'])).toEqual(['x', 'x'])
  })
})

describe('composePendingOnto — duplicate tag regression', () => {
  it('does not duplicate tags across two sibling update_character-style pending changes', () => {
    // Both changes were computed by the tool against the same live (unapproved)
    // character, so both have the identical stale `previous: { tags: [] }`.
    const change1 = { data: { tags: ['protagonist', 'flirt'] }, previous: { tags: [] } }
    const change2 = { data: { tags: ['protagonist', 'flirt'] }, previous: { tags: [] } }

    const composed = composePendingOnto({ tags: [] }, [change1, change2])

    expect(composed.tags).toEqual(['protagonist', 'flirt'])
  })

  it('composes three sibling changes that each add one distinct tag, with no duplicates', () => {
    const base = { tags: [] as string[] }
    const changes = [
      { data: { tags: ['a'] }, previous: { tags: [] } },
      { data: { tags: ['a', 'b'] }, previous: { tags: [] } },
      { data: { tags: ['a', 'b', 'c'] }, previous: { tags: [] } },
    ]

    expect(composePendingOnto(base, changes).tags).toEqual(['a', 'b', 'c'])
  })

  it('still composes genuinely different additions from independent siblings', () => {
    const base = { tags: ['existing'] }
    const changes = [
      { data: { tags: ['existing', 'x'] }, previous: { tags: ['existing'] } },
      { data: { tags: ['existing', 'y'] }, previous: { tags: ['existing'] } },
    ]

    expect(composePendingOnto(base, changes).tags).toEqual(['existing', 'x', 'y'])
  })
})

describe('mergeIntent', () => {
  it('returns an empty delta when nothing changed', () => {
    const data = { name: 'Alice', tags: ['a'] }
    expect(mergeIntent(data, data, data)).toEqual({})
  })

  it('only includes fields that actually changed', () => {
    const previous = { name: 'Alice', tags: ['a'] }
    const data = { name: 'Bob', tags: ['a'] }
    const live = { name: 'Alice', tags: ['a'] }
    expect(mergeIntent(data, previous, live)).toEqual({ name: 'Bob' })
  })
})
