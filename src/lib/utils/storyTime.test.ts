import { describe, it, expect } from 'vitest'
import { entryTime, entryTimeTag, formatStoryTimeOrNull, formatTimeSpan } from './storyTime'
import type { Chapter, StoryEntry, TimeTracker } from '$lib/types'

const t = (years: number, days: number, hours: number, minutes: number): TimeTracker => ({
  years,
  days,
  hours,
  minutes,
})

const entry = (metadata: StoryEntry['metadata'] = null): StoryEntry =>
  ({ type: 'narration', content: 'x', metadata }) as StoryEntry

const chapter = (
  startTime: TimeTracker | null = null,
  endTime: TimeTracker | null = null,
): Chapter => ({ number: 1, startTime, endTime }) as Chapter

describe('formatStoryTimeOrNull', () => {
  it('is 1-based on years and days, matching how the story is narrated', () => {
    expect(formatStoryTimeOrNull(t(0, 0, 0, 0))).toBe('Year 1, Day 1, 00:00')
    expect(formatStoryTimeOrNull(t(2, 3, 14, 30))).toBe('Year 3, Day 4, 14:30')
  })

  it('zero-pads both clock fields, so stamps line up when compared', () => {
    expect(formatStoryTimeOrNull(t(0, 0, 9, 5))).toBe('Year 1, Day 1, 09:05')
  })

  it('returns null for unknown rather than inventing the start of the story', () => {
    // The narrator-facing formatter returns "Year 1, Day 1" here. On retrieved material
    // that would assert something false.
    expect(formatStoryTimeOrNull(null)).toBeNull()
    expect(formatStoryTimeOrNull(undefined)).toBeNull()
  })
})

describe('formatTimeSpan', () => {
  it('renders a span', () => {
    expect(formatTimeSpan(t(0, 0, 8, 0), t(0, 1, 9, 30))).toBe(
      'Year 1, Day 1, 08:00 → Year 1, Day 2, 09:30',
    )
  })

  it('collapses to one instant when no time passed', () => {
    expect(formatTimeSpan(t(0, 0, 8, 0), t(0, 0, 8, 0))).toBe('Year 1, Day 1, 08:00')
  })

  it('uses whichever end is known', () => {
    expect(formatTimeSpan(t(0, 0, 8, 0), null)).toBe('Year 1, Day 1, 08:00')
    expect(formatTimeSpan(null, t(0, 0, 8, 0))).toBe('Year 1, Day 1, 08:00')
  })

  it('is null when nothing is known', () => {
    expect(formatTimeSpan(null, null)).toBeNull()
  })
})

describe('entryTime', () => {
  it('prefers the entry’s own stamp', () => {
    const result = entryTime(
      entry({ timeStart: t(0, 3, 10, 0), timeEnd: t(0, 3, 11, 0) }),
      chapter(t(0, 0, 0, 0), t(0, 9, 0, 0)),
    )

    expect(result).toEqual({
      label: 'Year 1, Day 4, 10:00 → Year 1, Day 4, 11:00',
      confidence: 'exact',
    })
  })

  it('falls back to the chapter span for entries written before time tracking', () => {
    const result = entryTime(entry(null), chapter(t(0, 0, 8, 0), t(0, 1, 8, 0)))

    expect(result.confidence).toBe('approximate')
    expect(result.label).toBe('Year 1, Day 1, 08:00 → Year 1, Day 2, 08:00')
  })

  it('admits when it does not know', () => {
    expect(entryTime(entry(null), chapter())).toEqual({ label: null, confidence: 'unknown' })
    expect(entryTime(entry(null))).toEqual({ label: null, confidence: 'unknown' })
  })
})

describe('entryTimeTag', () => {
  it('marks an approximate time with ~ so the agent can tell them apart', () => {
    expect(entryTimeTag(entry({ timeStart: t(0, 0, 8, 0) }))).toBe('[Year 1, Day 1, 08:00]')
    expect(entryTimeTag(entry(null), chapter(t(0, 0, 8, 0)))).toBe('[~Year 1, Day 1, 08:00]')
  })

  it('says so explicitly when the time is unknown', () => {
    expect(entryTimeTag(entry(null))).toBe('[time unknown]')
  })
})
