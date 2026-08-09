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

  it('collapses names that normalize to the same key, leaving no pair', () => {
    // "The Citadel" and "Citadel" are one subject to the detector, so there is nothing to
    // keep apart and nothing to store.
    expect(pairKeys(['The Citadel', 'Citadel'])).toEqual([])
  })
})
