import { describe, it, expect } from 'vitest'
import { mapPresentCharacters } from './imageMapper'
import { rawCharacters } from '../../../test/contextFixtures'
import type { Character } from '$lib/types'

describe('mapPresentCharacters', () => {
  describe('Aria (fully populated character)', () => {
    it('returns array of length 2 for rawCharacters', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result).toHaveLength(2)
    })

    it("result[0].name equals 'Aria'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].name).toBe('Aria')
    })

    it("result[0].description equals 'A skilled archer with a steady aim.'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].description).toBe('A skilled archer with a steady aim.')
    })

    it("result[0].relationship equals 'companion'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].relationship).toBe('companion')
    })

    it("result[0].traits equals ['brave', 'loyal']", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].traits).toEqual(['brave', 'loyal'])
    })

    it("result[0].status equals 'active'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].status).toBe('active')
    })

    it('result[0].visualDescriptors is the original object (not normalized)', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].visualDescriptors).toBe(rawCharacters[0].visualDescriptors)
    })

    it('result[0].portrait is null', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0].portrait).toBeNull()
    })
  })

  describe('Unknown Traveler (minimal character)', () => {
    it("result[1].name equals 'Unknown Traveler'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[1].name).toBe('Unknown Traveler')
    })

    it("result[1].description equals '' (null coalesced)", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[1].description).toBe('')
    })

    it("result[1].relationship equals '' (null coalesced)", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[1].relationship).toBe('')
    })

    it('result[1].traits is empty array', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[1].traits).toEqual([])
    })

    it("result[1].status equals 'inactive'", () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[1].status).toBe('inactive')
    })
  })

  describe('omitted fields (Omit<> verification)', () => {
    it('result[0] does not have id property', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0]).not.toHaveProperty('id')
    })

    it('result[0] does not have storyId property', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0]).not.toHaveProperty('storyId')
    })

    it('result[0] does not have metadata property', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0]).not.toHaveProperty('metadata')
    })

    it('result[0] does not have branchId property', () => {
      const result = mapPresentCharacters(rawCharacters)
      expect(result[0]).not.toHaveProperty('branchId')
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      const emptyChars: Character[] = []
      const result = mapPresentCharacters(emptyChars)
      expect(result).toHaveLength(0)
    })
  })

  describe('partial and varied characters', () => {
    const partialChar: Character = {
      id: 'char-partial',
      storyId: 'story-1',
      name: 'Halfling Scout',
      description: 'A quick and quiet halfling.',
      relationship: null,
      traits: ['stealthy'],
      visualDescriptors: {
        face: 'round, freckled',
        hair: 'curly auburn',
        eyes: '',
        build: '',
        clothing: 'green cloak',
        accessories: '',
        distinguishing: '',
      },
      portrait: 'data:image/png;base64,abc123',
      status: 'active',
      metadata: null,
      branchId: null,
    }

    const deceasedChar: Character = {
      id: 'char-deceased',
      storyId: 'story-1',
      name: 'Fallen Knight',
      description: null,
      relationship: 'enemy',
      traits: [],
      visualDescriptors: {},
      portrait: null,
      status: 'deceased',
      metadata: null,
      branchId: null,
    }

    it('maps partial visualDescriptors (only some fields populated)', () => {
      const result = mapPresentCharacters([partialChar])
      expect(result[0].visualDescriptors.face).toBe('round, freckled')
      expect(result[0].visualDescriptors.hair).toBe('curly auburn')
      expect(result[0].visualDescriptors.eyes).toBe('')
      expect(result[0].visualDescriptors.clothing).toBe('green cloak')
    })

    it('preserves non-null portrait value', () => {
      const result = mapPresentCharacters([partialChar])
      expect(result[0].portrait).toBe('data:image/png;base64,abc123')
    })

    it('maps deceased status correctly', () => {
      const result = mapPresentCharacters([deceasedChar])
      expect(result[0].status).toBe('deceased')
    })

    it('maps null relationship to empty string', () => {
      const result = mapPresentCharacters([partialChar])
      expect(result[0].relationship).toBe('')
    })
  })
})
