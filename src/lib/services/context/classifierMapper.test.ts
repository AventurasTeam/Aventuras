import { describe, it, expect } from 'vitest'
import { mapBeats, mapChatEntries } from './classifierMapper'
import { rawStoryBeats } from '../../../test/contextFixtures'
import type { StoryBeat, StoryEntry } from '$lib/types'

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

  describe('options', () => {
    it('truncates by default', () => {
      const longEntry: StoryEntry = {
        id: 'ce-long2',
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
      expect(result[0].content.length).toBe(503)
    })

    it('skips truncation when truncate: false', () => {
      const longEntry: StoryEntry = {
        id: 'ce-long3',
        storyId: 'story-1',
        type: 'narration',
        content: 'A'.repeat(600),
        parentId: null,
        position: 1,
        createdAt: 0,
        metadata: null,
        branchId: null,
      }
      const result = mapChatEntries([longEntry], { truncate: false })
      expect(result[0].content.length).toBe(600)
    })

    it('strips pic tags by default', () => {
      const result = mapChatEntries([chatEntries[2]])
      expect(result[0].content).not.toContain('<pic')
    })

    it('preserves pic tags when stripPicTags: false', () => {
      const result = mapChatEntries([chatEntries[2]], { stripPicTags: false })
      expect(result[0].content).toContain('<pic')
    })

    it('can combine truncate: false with stripPicTags: true', () => {
      const longWithPic: StoryEntry = {
        id: 'ce-lp',
        storyId: 'story-1',
        type: 'narration',
        content: 'A'.repeat(600) + ' <pic src="test.png" /> tail',
        parentId: null,
        position: 1,
        createdAt: 0,
        metadata: null,
        branchId: null,
      }
      const result = mapChatEntries([longWithPic], { truncate: false, stripPicTags: true })
      expect(result[0].content).not.toContain('<pic')
      expect(result[0].content.length).toBeGreaterThan(500)
    })
  })
})
