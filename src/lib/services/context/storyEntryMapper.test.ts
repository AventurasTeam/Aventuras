import { describe, it, expect } from 'vitest'
import { mapStoryEntriesToContext } from './storyEntryMapper'
import { rawStoryEntries } from '../../../test/contextFixtures'
import type { StoryEntry } from '$lib/types'

describe('mapStoryEntriesToContext', () => {
  describe('entry type and content preservation', () => {
    it('returns all 3 entries when no maxEntries set', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result).toHaveLength(3)
    })

    it("first entry type is 'narration'", () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result[0].type).toBe('narration')
    })

    it("first entry content equals 'The torches flickered.'", () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result[0].content).toBe('The torches flickered.')
    })

    it("second entry type is 'user_action'", () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result[1].type).toBe('user_action')
    })

    it("second entry content equals 'I draw my sword.'", () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result[1].content).toBe('I draw my sword.')
    })
  })

  describe('stripPicTags option', () => {
    it('stripPicTags:false — third entry content contains the raw <pic> tag markup', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: false })
      expect(result[2].content).toContain('<pic')
    })

    it('stripPicTags:true — third entry content does NOT contain <pic', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: true })
      expect(result[2].content).not.toContain('<pic')
    })

    it('stripPicTags:true — third entry content is empty', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: true })
      expect(result[2].content).toBe('')
    })
  })

  describe('maxEntries option', () => {
    it('maxEntries:2 — returns only last 2 entries', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, {
        stripPicTags: false,
        maxEntries: 2,
      })
      expect(result).toHaveLength(2)
    })

    it('maxEntries:2 — first result has content from rawStoryEntries[1], not rawStoryEntries[0]', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, {
        stripPicTags: false,
        maxEntries: 2,
      })
      expect(result[0].content).toBe('I draw my sword.')
    })

    it('maxEntries:1 — returns only the last entry', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, {
        stripPicTags: false,
        maxEntries: 1,
      })
      expect(result).toHaveLength(1)
    })

    it('maxEntries:1 — the single entry is the last entry (with pic tag)', () => {
      const result = mapStoryEntriesToContext(rawStoryEntries, {
        stripPicTags: false,
        maxEntries: 1,
      })
      expect(result[0].content).toContain('<pic')
    })
  })

  describe('edge cases', () => {
    it('empty input returns empty array', () => {
      const emptyEntries: StoryEntry[] = []
      const result = mapStoryEntriesToContext(emptyEntries, { stripPicTags: false })
      expect(result).toHaveLength(0)
    })
  })
})
