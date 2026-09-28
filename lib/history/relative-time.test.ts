import { describe, expect, it } from 'vitest'

import { relativeTimeLabel } from './relative-time'

describe('relativeTimeLabel', () => {
  it('reads "just now" under a minute, including a future/negative delta', () => {
    expect(relativeTimeLabel(0, 59_000)).toBe('just now')
    expect(relativeTimeLabel(10_000, 0)).toBe('just now')
  })

  it('reads "1 min ago" at exactly 60 seconds, not "just now"', () => {
    expect(relativeTimeLabel(0, 60_000)).toBe('1 min ago')
  })

  it('crosses from minutes to hours at 60 minutes', () => {
    expect(relativeTimeLabel(0, 59 * 60_000)).toBe('59 min ago')
    expect(relativeTimeLabel(0, 60 * 60_000)).toBe('1 h ago')
  })

  it('crosses from hours to days at 24 hours', () => {
    expect(relativeTimeLabel(0, 23 * 3_600_000)).toBe('23 h ago')
    expect(relativeTimeLabel(0, 24 * 3_600_000)).toBe('1 d ago')
  })

  it('crosses from days to weeks at 7 days', () => {
    expect(relativeTimeLabel(0, 6 * 86_400_000)).toBe('6 d ago')
    expect(relativeTimeLabel(0, 7 * 86_400_000)).toBe('1 w ago')
  })
})
