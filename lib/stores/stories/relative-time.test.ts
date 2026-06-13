import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from './relative-time'

const NOW = 1_000_000 // seconds

describe('formatRelativeTime', () => {
  it('returns "Never" for null', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Never')
  })
  it('returns "just now" under a minute', () => {
    expect(formatRelativeTime(NOW - 30, NOW)).toBe('just now')
  })
  it('floors to whole minutes/hours/days', () => {
    expect(formatRelativeTime(NOW - 60, NOW)).toBe('1m ago')
    expect(formatRelativeTime(NOW - 60 * 90, NOW)).toBe('1h ago')
    expect(formatRelativeTime(NOW - 86_400 * 3, NOW)).toBe('3d ago')
  })
  it('switches to weeks past 7 days', () => {
    expect(formatRelativeTime(NOW - 86_400 * 14, NOW)).toBe('2w ago')
  })
  it('clamps a future timestamp to "just now"', () => {
    expect(formatRelativeTime(NOW + 500, NOW)).toBe('just now')
  })
})
