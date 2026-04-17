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
    const factionEntry = entries[1]

    it('has name The Shadow Guild', () => {
      expect(factionEntry.name).toBe('The Shadow Guild')
    })

    it('has type faction', () => {
      expect(factionEntry.type).toBe('faction')
    })

    it('description is not empty string', () => {
      expect(factionEntry.description.length).toBeGreaterThan(0)
      expect(factionEntry.description).toContain('thieves')
    })
  })

  describe('character entry (Lord Malachar)', () => {
    const charEntry = entries[0]

    it('has name Lord Malachar', () => {
      expect(charEntry.name).toBe('Lord Malachar')
    })

    it('has type character', () => {
      expect(charEntry.type).toBe('character')
    })

    it('preserves state with currentDisposition', () => {
      expect(charEntry.state?.type).toBe('character')
      if (charEntry.state?.type === 'character') {
        expect(charEntry.state.currentDisposition).toBe('hostile')
      }
    })
  })

  describe('description truncation', () => {
    it('truncates descriptions when maxWordsPerEntry is set', () => {
      const result = mapEntryRetrievalToLorebookEntries(entryRetrievalResult, 3)
      expect(result[0].description).toMatch(/\.\.\.$/)
    })

    it('preserves full descriptions when maxWordsPerEntry is 0', () => {
      const result = mapEntryRetrievalToLorebookEntries(entryRetrievalResult, 0)
      expect(result[0].description).not.toMatch(/\.\.\.$/)
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
