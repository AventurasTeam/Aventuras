import { describe, it, expect } from 'vitest'
import {
  parseDuration,
  formatDuration,
  durationIsInvalid,
  parseStoryTime,
  formatStoryTime,
  storyTimeIsInvalid,
} from './duration'

const DAY = 24 * 60
const YEAR = 365 * DAY

describe('parseDuration', () => {
  it('reads a bare number as minutes', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('0')).toBe(0)
  })

  it('reads single units', () => {
    expect(parseDuration('30m')).toBe(30)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('3d')).toBe(3 * DAY)
    expect(parseDuration('1y')).toBe(YEAR)
  })

  it('reads combinations, in any order and however spaced', () => {
    expect(parseDuration('1d 2h 30m')).toBe(DAY + 150)
    expect(parseDuration('2h30m')).toBe(150)
    expect(parseDuration('30m 2h')).toBe(150)
    expect(parseDuration('  3D  4H  ')).toBe(3 * DAY + 240)
  })

  it('covers spans far longer than minutes', () => {
    expect(parseDuration('90d')).toBe(90 * DAY)
    expect(parseDuration('1y 2d')).toBe(YEAR + 2 * DAY)
  })

  it('treats an empty field as unanswered rather than zero', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('   ')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration(undefined)).toBeNull()
  })

  it('rejects what it cannot read', () => {
    for (const bad of ['soon', '-5', '1.5h', '3w', 'h', '2 hours', '1d 2d', '--']) {
      expect(parseDuration(bad), bad).toBeNull()
    }
  })

  it('rejects a unit given twice, which would silently sum', () => {
    expect(parseDuration('1h 2h')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('renders what parseDuration reads', () => {
    for (const text of ['30m', '2h', '3d', '1y', '1d 2h 30m', '1y 2d']) {
      expect(formatDuration(parseDuration(text)!)).toBe(text)
    }
  })

  it('omits the units that are zero', () => {
    expect(formatDuration(DAY)).toBe('1d')
    expect(formatDuration(DAY + 5)).toBe('1d 5m')
  })

  it('renders nothing at all as zero minutes', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(-10)).toBe('0m')
  })
})

describe('durationIsInvalid', () => {
  it('is false for an untouched field, which is merely unanswered', () => {
    expect(durationIsInvalid('')).toBe(false)
    expect(durationIsInvalid(undefined)).toBe(false)
  })

  it('is true only when something typed cannot be read', () => {
    expect(durationIsInvalid('90')).toBe(false)
    expect(durationIsInvalid('2h 30m')).toBe(false)
    expect(durationIsInvalid('later')).toBe(true)
    expect(durationIsInvalid('-1')).toBe(true)
  })
})

describe('parseStoryTime', () => {
  it('reads the format the interface displays', () => {
    expect(parseStoryTime('Y1 D1 00:00')).toEqual({ years: 0, days: 0, hours: 0, minutes: 0 })
    expect(parseStoryTime('Y1 D4 14:30')).toEqual({ years: 0, days: 3, hours: 14, minutes: 30 })
    expect(parseStoryTime('Y3 D200 07:05')).toEqual({ years: 2, days: 199, hours: 7, minutes: 5 })
  })

  it('defaults the year and day when they are left off', () => {
    expect(parseStoryTime('14:30')).toEqual({ years: 0, days: 0, hours: 14, minutes: 30 })
    expect(parseStoryTime('D4 14:30')).toEqual({ years: 0, days: 3, hours: 14, minutes: 30 })
  })

  it('is forgiving about case and spacing', () => {
    expect(parseStoryTime('  y1   d4   14:30 ')).toEqual(parseStoryTime('Y1 D4 14:30'))
    expect(parseStoryTime('y 1 d 4 14:30')).toEqual(parseStoryTime('Y1 D4 14:30'))
  })

  it('rejects what it cannot read', () => {
    for (const bad of ['', 'later', 'Y1 D4', '25:00', '14:60', 'Y0 D1 00:00', 'D0 00:00', '1430']) {
      expect(parseStoryTime(bad), bad).toBeNull()
    }
  })

  it('round-trips through formatStoryTime', () => {
    for (const text of ['Y1 D1 00:00', 'Y1 D4 14:30', 'Y3 D200 07:05']) {
      expect(formatStoryTime(parseStoryTime(text)!)).toBe(text)
    }
  })
})

describe('storyTimeIsInvalid', () => {
  it('is false for an untouched field', () => {
    expect(storyTimeIsInvalid('')).toBe(false)
    expect(storyTimeIsInvalid(undefined)).toBe(false)
  })

  it('is true only for text that is not a story time', () => {
    expect(storyTimeIsInvalid('Y1 D4 14:30')).toBe(false)
    expect(storyTimeIsInvalid('half past two')).toBe(true)
  })
})
