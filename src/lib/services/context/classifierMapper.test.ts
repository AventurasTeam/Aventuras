import { describe, it, expect } from 'vitest'
import { mapCharacters, mapBeats } from './classifierMapper'
import { rawCharacters, rawStoryBeats } from '../../../test/contextFixtures'
import type { Character, StoryBeat } from '$lib/types'

describe('mapCharacters', () => {
  describe('Aria (fully populated character)', () => {
    it('returns array of length 2 for rawCharacters', () => {
      const result = mapCharacters(rawCharacters)
      expect(result).toHaveLength(2)
    })

    it("result[0].name equals 'Aria'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].name).toBe('Aria')
    })

    it("result[0].description equals 'A skilled archer with a steady aim.'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].description).toBe('A skilled archer with a steady aim.')
    })

    it("result[0].relationship equals 'companion'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].relationship).toBe('companion')
    })

    it("result[0].traits equals ['brave', 'loyal']", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].traits).toEqual(['brave', 'loyal'])
    })

    it('result[0].appearance has length 7 (all visualDescriptor fields populated)', () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].appearance).toHaveLength(7)
    })

    it("result[0].status equals 'active'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].status).toBe('active')
    })

    it('result[0].tier equals 1', () => {
      const result = mapCharacters(rawCharacters)
      expect(result[0].tier).toBe(1)
    })
  })

  describe('Unknown Traveler (minimal character)', () => {
    it("result[1].name equals 'Unknown Traveler'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].name).toBe('Unknown Traveler')
    })

    it("result[1].description equals '' (null coalesced)", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].description).toBe('')
    })

    it("result[1].relationship equals '' (null coalesced)", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].relationship).toBe('')
    })

    it('result[1].traits is empty array', () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].traits).toEqual([])
    })

    it('result[1].appearance is empty array (empty visualDescriptors object)', () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].appearance).toHaveLength(0)
    })

    it("result[1].status equals 'inactive'", () => {
      const result = mapCharacters(rawCharacters)
      expect(result[1].status).toBe('inactive')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const emptyChars: Character[] = []
      const result = mapCharacters(emptyChars)
      expect(result).toHaveLength(0)
    })
  })
})

describe('mapBeats', () => {
  describe('Find the Lost Key (fully populated beat)', () => {
    it('returns array of length 2 for rawStoryBeats', () => {
      const result = mapBeats(rawStoryBeats)
      expect(result).toHaveLength(2)
    })

    it("result[0].title equals 'Find the Lost Key'", () => {
      const result = mapBeats(rawStoryBeats)
      expect(result[0].title).toBe('Find the Lost Key')
    })

    it("result[0].description equals 'Retrieve the key to the sealed vault.'", () => {
      const result = mapBeats(rawStoryBeats)
      expect(result[0].description).toBe('Retrieve the key to the sealed vault.')
    })

    it("result[0].type equals 'quest'", () => {
      const result = mapBeats(rawStoryBeats)
      expect(result[0].type).toBe('quest')
    })

    it("result[0].status equals 'active'", () => {
      const result = mapBeats(rawStoryBeats)
      expect(result[0].status).toBe('active')
    })
  })

  describe('The Darkness (minimal beat)', () => {
    it("result[1].description equals '' (null coalesced)", () => {
      const result = mapBeats(rawStoryBeats)
      expect(result[1].description).toBe('')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const emptyBeats: StoryBeat[] = []
      const result = mapBeats(emptyBeats)
      expect(result).toHaveLength(0)
    })
  })
})
