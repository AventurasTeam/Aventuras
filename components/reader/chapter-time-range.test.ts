import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN, MAX_WORLD_TIME_SECONDS, type CalendarFrame } from '@/lib/calendar'

import { chapterTimeRangeLabel, worldTimeLabel } from './chapter-time-range'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
const FRAME: CalendarFrame = { calendar: EARTH_GREGORIAN, origin: ORIGIN }

describe('chapterTimeRangeLabel', () => {
  it('joins two different ends', () => {
    expect(chapterTimeRangeLabel({ first: 3_600, last: 7_200 }, FRAME)).toBe(
      'January 1, 2024 AD 01:00 → January 1, 2024 AD 02:00',
    )
  })

  it('gives one label when both ends format the same', () => {
    expect(chapterTimeRangeLabel({ first: 3_600, last: 3_601 }, FRAME)).toBe(
      'January 1, 2024 AD 01:00',
    )
  })

  it('is null on a miss at either end', () => {
    const past = MAX_WORLD_TIME_SECONDS + 1
    expect(chapterTimeRangeLabel({ first: past, last: 7_200 }, FRAME)).toBeNull()
    expect(chapterTimeRangeLabel({ first: 3_600, last: past }, FRAME)).toBeNull()
  })

  it('is null when the calendar renders empty', () => {
    const empty = { ...FRAME, calendar: { ...EARTH_GREGORIAN, displayFormat: '' } }
    expect(chapterTimeRangeLabel({ first: 3_600, last: 7_200 }, empty)).toBeNull()
  })

  it('is null with no range or no frame', () => {
    expect(chapterTimeRangeLabel(undefined, FRAME)).toBeNull()
    expect(chapterTimeRangeLabel({ first: 3_600, last: 7_200 }, null)).toBeNull()
  })
})

describe('worldTimeLabel', () => {
  it('formats one time', () => {
    expect(worldTimeLabel(3_600, FRAME)).toBe('January 1, 2024 AD 01:00')
  })

  it('is null with no frame', () => {
    expect(worldTimeLabel(3_600, null)).toBeNull()
  })

  it('is null on a format miss', () => {
    expect(worldTimeLabel(MAX_WORLD_TIME_SECONDS + 1, FRAME)).toBeNull()
  })

  it('is null when the calendar renders empty', () => {
    const empty = { ...FRAME, calendar: { ...EARTH_GREGORIAN, displayFormat: '' } }
    expect(worldTimeLabel(3_600, empty)).toBeNull()
  })
})
