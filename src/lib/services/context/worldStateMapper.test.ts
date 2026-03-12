import { describe, it, expect } from 'vitest'
import { mapContextResultToArrays, normalizeAppearance } from './worldStateMapper'
import { contextResult, emptyWorldState } from '../../../test/contextFixtures'

describe('mapContextResultToArrays', () => {
  const result = mapContextResultToArrays(contextResult, emptyWorldState)

  describe('characters', () => {
    it('worldStateCharacters[0].name equals Aria (tier-1 character)', () => {
      expect(result.worldStateCharacters[0].name).toBe('Aria')
    })

    it('worldStateCharacters[1].name equals Lord Malachar (tier-2 character)', () => {
      expect(result.worldStateCharacters[1].name).toBe('Lord Malachar')
    })
  })

  describe('inventory', () => {
    it('tier-1 item appears in worldStateInventory', () => {
      expect(result.worldStateInventory[0].name).toBe('Iron Dagger')
    })

    it('tier-1 item tier field is undefined (absent from ContextItem for inventory)', () => {
      expect(result.worldStateInventory[0].tier).toBeUndefined()
    })
  })

  describe('relevant items', () => {
    it('tier-2 item appears in worldStateRelevantItems (not in worldStateInventory)', () => {
      expect(result.worldStateRelevantItems[0].name).toBe('Ancient Tome')
    })

    it('tier-2 item is not in worldStateInventory', () => {
      const names = result.worldStateInventory.map((i) => i.name)
      expect(names).not.toContain('Ancient Tome')
    })

    it('tier-2 item tier field equals 2', () => {
      expect(result.worldStateRelevantItems[0].tier).toBe(2)
    })
  })

  describe('beats', () => {
    it('tier-1 beat appears in worldStateBeats', () => {
      expect(result.worldStateBeats[0].title).toBe('Find the Lost Key')
    })

    it('tier-1 beat tier field is undefined (absent from ContextStoryBeat for active beats)', () => {
      expect(result.worldStateBeats[0].tier).toBeUndefined()
    })
  })

  describe('related beats', () => {
    it('tier-2 beat appears in worldStateRelatedBeats', () => {
      expect(result.worldStateRelatedBeats[0].title).toBe('The Dark Prophecy')
    })

    it('tier-2 beat tier field equals 2', () => {
      expect(result.worldStateRelatedBeats[0].tier).toBe(2)
    })
  })

  describe('locations', () => {
    it('tier-3 non-current location appears in worldStateLocations', () => {
      expect(result.worldStateLocations[0].name).toBe('Dark Forest')
    })
  })

  describe('currentLocationObject', () => {
    it('is non-null when tier-1 location has metadata.current=true', () => {
      expect(result.currentLocationObject).not.toBeNull()
    })

    it('.name equals The Crossroads Inn', () => {
      expect(result.currentLocationObject?.name).toBe('The Crossroads Inn')
    })
  })
})

describe('normalizeAppearance', () => {
  describe('object format', () => {
    const fullObject = {
      face: 'sharp features',
      hair: 'dark braid',
      eyes: 'amber',
      build: 'lithe',
      clothing: 'leather armor',
      accessories: 'quiver',
      distinguishing: 'scar on left cheek',
    }

    it('returns non-empty array when passed object with 7 fields', () => {
      const result = normalizeAppearance(fullObject)
      expect(result.length).toBeGreaterThan(0)
    })

    it('returned array length equals 7 (one entry per non-empty field)', () => {
      const result = normalizeAppearance(fullObject)
      expect(result).toHaveLength(7)
      expect(result[0]).toBe('sharp features')
    })
  })

  describe('string[] legacy format', () => {
    it('returns the array unchanged when passed string[]', () => {
      const input = ['tall', 'dark hair', 'blue eyes']
      const result = normalizeAppearance(input)
      expect(result).toEqual(input)
    })
  })

  describe('null/falsy input', () => {
    it('returns [] when passed null', () => {
      expect(normalizeAppearance(null)).toEqual([])
    })

    it('returns [] when passed undefined', () => {
      expect(normalizeAppearance(undefined)).toEqual([])
    })
  })
})
