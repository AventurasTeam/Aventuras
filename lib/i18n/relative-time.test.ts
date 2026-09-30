import { describe, expect, it } from 'vitest'

import { relativeTimeLabel } from './relative-time'

const DAY = 86_400_000
// Local-time constructors: the absolute form renders in the device's zone.
const APR_12 = new Date(2026, 3, 12, 14, 33).getTime()

describe('relativeTimeLabel', () => {
  it('reads "just now" under a minute, including a future/negative delta', () => {
    expect(relativeTimeLabel(0, 59_000)).toBe('just now')
    expect(relativeTimeLabel(10_000, 0)).toBe('just now')
  })

  it('reads "1m ago" at exactly 60 seconds, not "just now"', () => {
    expect(relativeTimeLabel(0, 60_000)).toBe('1m ago')
  })

  it('crosses from minutes to hours at 60 minutes', () => {
    expect(relativeTimeLabel(0, 59 * 60_000)).toBe('59m ago')
    expect(relativeTimeLabel(0, 60 * 60_000)).toBe('1h ago')
  })

  it('crosses from hours to days at 24 hours', () => {
    expect(relativeTimeLabel(0, 23 * 3_600_000)).toBe('23h ago')
    expect(relativeTimeLabel(0, DAY)).toBe('1d ago')
  })

  it('switches to the date and time at 7 days', () => {
    expect(relativeTimeLabel(APR_12, APR_12 + 7 * DAY - 1)).toBe('6d ago')
    expect(relativeTimeLabel(APR_12, APR_12 + 7 * DAY)).toBe('12 Apr, 14:33')
  })

  it('writes the time on a 24-hour clock from 00:00', () => {
    const midnight = new Date(2026, 3, 2, 0, 5).getTime()
    expect(relativeTimeLabel(midnight, midnight + 8 * DAY)).toBe('2 Apr, 00:05')
  })

  it('adds the year to a date outside the current year', () => {
    const lastYear = new Date(2025, 11, 30, 9, 5).getTime()
    expect(relativeTimeLabel(lastYear, new Date(2026, 0, 10).getTime())).toBe('30 Dec 2025, 09:05')
    expect(relativeTimeLabel(APR_12, new Date(2026, 11, 31).getTime())).toBe('12 Apr, 14:33')
  })
})
