import { describe, it, expect } from 'vitest'
import { findEntityDuplicates, keptSeparateKey, pairKeys } from './index'

const chars = (...names: string[]) => names.map((name, i) => ({ id: `c${i}`, name }))

describe('findEntityDuplicates', () => {
  it('groups the title variants a classifier mints for one person', () => {
    // The measured case: the narrator calls him by a different rank each act.
    const groups = findEntityDuplicates(
      'character',
      chars("Vor'koth", "Captain Vor'koth", "General Vor'koth"),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].entities.map((e) => e.name)).toEqual([
      "Vor'koth",
      "Captain Vor'koth",
      "General Vor'koth",
    ])
  })

  it('compares world-state records within their own pool only', () => {
    // A location and a character sharing a word are a namesake. Records of one pool are
    // all the same kind of thing, so the pool stands in for the type.
    const asCharacters = findEntityDuplicates('character', chars('Ashford', 'Ashford Keep'))
    expect(asCharacters).toHaveLength(1)
  })

  it('leaves unrelated names alone', () => {
    expect(findEntityDuplicates('character', chars('Mara', 'Tovin'))).toEqual([])
  })

  it('reads a lorebook entry’s aliases, which world-state records do not have', () => {
    const groups = findEntityDuplicates('lorebook', [
      { id: 'a', name: 'Kael', type: 'character' },
      { id: 'b', name: 'Kaelthas', type: 'character', aliases: ['Kael'] },
    ])
    expect(groups[0].reason).toBe('shared-alias')
  })
})

describe('dismissals', () => {
  it('drops a group whose every pair has been dismissed', () => {
    const dismissed = new Set(pairKeys(['Kaelen', 'Kaelan']))
    expect(findEntityDuplicates('character', chars('Kaelen', 'Kaelan'), dismissed)).toEqual([])
  })

  it('keeps a group that grew a member the user has not ruled on', () => {
    // Transitivity is why dismissals are stored per pair: closing {A,B} must not silently
    // close {A,B,C} when C shows up.
    const dismissed = new Set(pairKeys(['Kaelen', 'Kaelan']))
    const groups = findEntityDuplicates(
      'character',
      chars('Kaelen', 'Kaelan', 'Kaelen the Bold'),
      dismissed,
    )
    expect(groups).toHaveLength(1)
  })

  it('matches a dismissal after a rename that folds to the same key', () => {
    const dismissed = new Set(pairKeys(['The Citadel', 'Citadel Keep']))
    expect(pairKeys(['citadel', 'citadel keep']).every((p) => dismissed.has(p))).toBe(true)
  })

  it('is order-independent', () => {
    expect(keptSeparateKey(['Kaelen', 'Kaelan'])).toBe(keptSeparateKey(['Kaelan', 'Kaelen']))
  })

  it('expands a group of three into its three pairs', () => {
    expect(pairKeys(['Kaelen', 'Kaelan', 'Kaelen the Bold'])).toHaveLength(3)
  })

  it('gives a group whose names normalize alike a self-pair rather than nothing', () => {
    // "The Citadel" and "Citadel" fold to one key, but they are still two rows the user
    // was shown and can rule on. An empty list would read as "already dismissed" to
    // `isOpen` and drop the group before it was ever offered.
    expect(pairKeys(['The Citadel', 'Citadel'])).toEqual(['citadel|citadel'])
    expect(pairKeys(['Kaelen', 'Kaelen'])).toEqual(['kaelen|kaelen'])
  })

  it('offers two rows with the same name, and remembers them being kept apart', () => {
    // The commonest duplicate of all, and the only one nobody has to judge.
    const groups = findEntityDuplicates('character', chars('Kaelen', 'Kaelen'))
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('same-name')

    const dismissed = new Set(pairKeys(groups[0].entities.map((e) => e.name)))
    expect(findEntityDuplicates('character', chars('Kaelen', 'Kaelen'), dismissed)).toEqual([])
  })

  it('qualifies a group key by pool, since the names repeat across them', () => {
    // A `Character` row and the lorebook `Entry` for the same person drift the same way,
    // so the worklist holds two groups with identical names. The window keys its `{#each}`
    // on this, where a collision is a render error.
    const asCharacter = findEntityDuplicates('character', chars('Kaelen', 'Kaelan'))[0]
    const asEntry = findEntityDuplicates('lorebook', [
      { id: 'e0', name: 'Kaelen', type: 'character' },
      { id: 'e1', name: 'Kaelan', type: 'character' },
    ])[0]
    expect(asCharacter.key).not.toBe(asEntry.key)
  })
})
