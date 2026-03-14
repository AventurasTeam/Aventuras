import { describe, it, expect } from 'vitest'
import { mapChaptersToContext, formatStoryTime } from './chapterMapper'
import { rawChapters, timelineFillResult } from '../../../test/contextFixtures'

describe('mapChaptersToContext', () => {
  describe('chapter mapping', () => {
    it('returns chapters array of length 2 from rawChapters fixture', () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters).toHaveLength(2)
    })

    it('chapters[0].number equals 1', () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[0].number).toBe(1)
    })

    it("chapters[0].title equals 'The Beginning'", () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[0].title).toBe('The Beginning')
    })

    it("chapters[0].characters contains 'Aria'", () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[0].characters).toContain('Aria')
    })

    it("chapters[0].emotionalTone equals 'hopeful'", () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[0].emotionalTone).toBe('hopeful')
    })
  })

  describe('null field coalescing', () => {
    it("chapters[1].title equals '' when title is null in input", () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[1].title).toBe('')
    })

    it("chapters[1].emotionalTone equals '' when emotionalTone is null in input", () => {
      const { chapters } = mapChaptersToContext(rawChapters)
      expect(chapters[1].emotionalTone).toBe('')
    })
  })

  describe('with timelineFill', () => {
    it('returns timelineFill array of length 1 when timelineFillResult passed', () => {
      const { timelineFill } = mapChaptersToContext(rawChapters, timelineFillResult)
      expect(timelineFill).toHaveLength(1)
    })

    it("timelineFill[0].query equals 'What happened between chapters?'", () => {
      const { timelineFill } = mapChaptersToContext(rawChapters, timelineFillResult)
      expect(timelineFill[0].query).toBe('What happened between chapters?')
    })

    it("timelineFill[0].answer equals 'A journey occurred.'", () => {
      const { timelineFill } = mapChaptersToContext(rawChapters, timelineFillResult)
      expect(timelineFill[0].answer).toBe('A journey occurred.')
    })

    it('timelineFill[0].chapterNumbers includes 1 and 2', () => {
      const { timelineFill } = mapChaptersToContext(rawChapters, timelineFillResult)
      expect(timelineFill[0].chapterNumbers).toContain(1)
      expect(timelineFill[0].chapterNumbers).toContain(2)
    })
  })

  describe('without timelineFill', () => {
    it('timelineFill array is empty when no second arg passed', () => {
      const { timelineFill } = mapChaptersToContext(rawChapters)
      expect(timelineFill).toHaveLength(0)
    })

    it('timelineFill array is empty when null passed', () => {
      const { timelineFill } = mapChaptersToContext(rawChapters, null)
      expect(timelineFill).toHaveLength(0)
    })
  })
})

describe('formatStoryTime', () => {
  it('returns default time string for null input', () => {
    const result = formatStoryTime(null)
    expect(result).toBe('Year 1, Day 1, 0 hours 0 minutes')
  })

  it('returns default time string for undefined input', () => {
    const result = formatStoryTime(undefined)
    expect(result).toBe('Year 1, Day 1, 0 hours 0 minutes')
  })

  it('formats a TimeTracker correctly', () => {
    const result = formatStoryTime({ years: 1, days: 2, hours: 8, minutes: 30 })
    expect(result).toBe('Year 2, Day 3, 8 hours 30 minutes')
  })
})
