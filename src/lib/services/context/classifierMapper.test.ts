import { describe, it, expect } from 'vitest'
import { mapCharacters, mapBeats, mapChatEntries } from './classifierMapper'
import { rawCharacters, rawStoryBeats } from '../../../test/contextFixtures'
import type { Character, StoryBeat, StoryEntry } from '$lib/types'

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

/** Inline fixtures for mapChatEntries — not in shared contextFixtures */
const chatEntries: StoryEntry[] = [
  {
    id: 'ce-1',
    storyId: 'story-1',
    type: 'user_action',
    content: 'I open the door.',
    parentId: null,
    position: 1,
    createdAt: 0,
    metadata: {
      timeStart: { years: 1, days: 3, hours: 9, minutes: 30 },
    },
    branchId: null,
  },
  {
    id: 'ce-2',
    storyId: 'story-1',
    type: 'narration',
    content: 'The room is empty.',
    parentId: null,
    position: 2,
    createdAt: 0,
    metadata: null,
    branchId: null,
  },
  {
    id: 'ce-3',
    storyId: 'story-1',
    type: 'narration',
    content: 'A dragon appeared. <pic src="dragon.png" /> The flames spread quickly.',
    parentId: null,
    position: 3,
    createdAt: 0,
    metadata: {
      timeStart: { years: 2, days: 15, hours: 0, minutes: 5 },
    },
    branchId: null,
  },
]

describe('mapChatEntries', () => {
  it('maps type and content fields', () => {
    const result = mapChatEntries([chatEntries[0]])
    expect(result[0].type).toBe('user_action')
    expect(result[0].content).toBe('I open the door.')
  })

  it('formats timeStart as YxDy HH:MM from metadata.timeStart', () => {
    const result = mapChatEntries([chatEntries[0]])
    expect(result[0].timeStart).toBe('Y1D3 09:30')
  })

  it('returns empty timeStart when metadata is null', () => {
    const result = mapChatEntries([chatEntries[1]])
    expect(result[0].timeStart).toBe('')
  })

  it('zero-pads hours and minutes', () => {
    const result = mapChatEntries([chatEntries[2]])
    expect(result[0].timeStart).toBe('Y2D15 00:05')
  })

  it('strips pic tags from content before truncation', () => {
    const result = mapChatEntries([chatEntries[2]])
    expect(result[0].content).not.toContain('<pic')
    expect(result[0].content).toContain('A dragon appeared.')
    expect(result[0].content).toContain('The flames spread quickly.')
  })

  it('truncates content longer than 500 chars with "..." suffix', () => {
    const longEntry: StoryEntry = {
      id: 'ce-long',
      storyId: 'story-1',
      type: 'narration',
      content: 'A'.repeat(600),
      parentId: null,
      position: 1,
      createdAt: 0,
      metadata: null,
      branchId: null,
    }
    const result = mapChatEntries([longEntry])
    expect(result[0].content).toBe('A'.repeat(500) + '...')
    expect(result[0].content.length).toBe(503)
  })

  it('does not truncate content at exactly 500 chars', () => {
    const exactEntry: StoryEntry = {
      id: 'ce-exact',
      storyId: 'story-1',
      type: 'narration',
      content: 'B'.repeat(500),
      parentId: null,
      position: 1,
      createdAt: 0,
      metadata: null,
      branchId: null,
    }
    const result = mapChatEntries([exactEntry])
    expect(result[0].content).toBe('B'.repeat(500))
    expect(result[0].content.length).toBe(500)
  })

  it('returns empty array for empty input', () => {
    const result = mapChatEntries([])
    expect(result).toHaveLength(0)
  })
})
