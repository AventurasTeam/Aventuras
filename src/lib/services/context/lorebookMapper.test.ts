import { describe, it, expect } from 'vitest'
import { mapEntryRetrievalToLorebookEntries } from './lorebookMapper'
import { entryRetrievalResult } from '../../../test/contextFixtures'
import type { EntryRetrievalResult } from '$lib/services/ai/retrieval/EntryRetrievalService'

describe('mapEntryRetrievalToLorebookEntries', () => {
  const entries = mapEntryRetrievalToLorebookEntries(entryRetrievalResult, 500)

  it('returns array of length 2 from entryRetrievalResult fixture', () => {
    expect(entries).toHaveLength(2)
  })

  describe('faction entry (The Shadow Guild)', () => {
    // entryRetrievalResult.all is [characterRetrievedEntry, factionRetrievedEntry]
    const factionEntry = entries[1]

    it('has name The Shadow Guild', () => {
      expect(factionEntry.name).toBe('The Shadow Guild')
    })

    it('has type faction', () => {
      expect(factionEntry.type).toBe('faction')
    })

    it('tier equals 2', () => {
      expect(factionEntry.tier).toBe(2)
    })

    it('has no disposition property (state.type !== character)', () => {
      expect(factionEntry.disposition).toBeUndefined()
    })

    it('description is not empty string', () => {
      expect(factionEntry.description.length).toBeGreaterThan(0)
      expect(factionEntry.description).toContain('thieves')
    })
  })

  describe('character entry (Lord Malachar)', () => {
    // entryRetrievalResult.all is [characterRetrievedEntry, factionRetrievedEntry]
    const charEntry = entries[0]

    it('has name Lord Malachar', () => {
      expect(charEntry.name).toBe('Lord Malachar')
    })

    it('has type character', () => {
      expect(charEntry.type).toBe('character')
    })

    it('tier equals 1', () => {
      expect(charEntry.tier).toBe(1)
    })

    it('has disposition hostile', () => {
      expect(charEntry.disposition).toBe('hostile')
    })
  })

  describe('edge case: empty EntryRetrievalResult', () => {
    it('returns empty array for empty result', () => {
      const emptyResult = { all: [], tier1: [], tier2: [], tier3: [] } as EntryRetrievalResult
      const result = mapEntryRetrievalToLorebookEntries(emptyResult, 500)
      expect(result).toHaveLength(0)
      expect(result).toEqual([])
    })
  })
})
