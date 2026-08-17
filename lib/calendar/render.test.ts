import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import { MAX_WORLD_TIME_SECONDS } from './limits'
import { formatWorldTime, FormatMiss } from './render'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

describe('formatWorldTime → renderable range', () => {
  // Resolving an integer to a tuple walks the top tier one unit at a time, so
  // an out-of-range value is a UI-thread freeze rather than a wrong string.
  it('misses instead of walking a value past the ceiling', () => {
    const out = formatWorldTime(MAX_WORLD_TIME_SECONDS + 1, EARTH_GREGORIAN, ORIGIN)
    expect(out).toBeInstanceOf(FormatMiss)
  })

  it('still renders the ceiling itself', () => {
    expect(formatWorldTime(MAX_WORLD_TIME_SECONDS, EARTH_GREGORIAN, ORIGIN)).not.toBeInstanceOf(
      FormatMiss,
    )
  })

  it('misses on a negative or non-finite worldTime', () => {
    expect(formatWorldTime(-1, EARTH_GREGORIAN, ORIGIN)).toBeInstanceOf(FormatMiss)
    expect(formatWorldTime(Number.NaN, EARTH_GREGORIAN, ORIGIN)).toBeInstanceOf(FormatMiss)
  })
})

describe('formatWorldTime', () => {
  it('renders the displayFormat with monthName + tier values', () => {
    const out = formatWorldTime(0, EARTH_GREGORIAN, ORIGIN)
    expect(out).toContain('January')
    expect(out).toContain('2024 AD')
  })
  it('renders BC for a year < 1', () => {
    const bc = { year: -43, month: 3, day: 15, hour: 0, minute: 0, second: 0 }
    expect(formatWorldTime(0, EARTH_GREGORIAN, bc)).toContain('44 BC')
  })
  // Expected strings are derived from EARTH_GREGORIAN's displayFormat plus the
  // month labels and hour/minute startValues — not from what render.ts emits.
  it('completes an origin that omits tiers before rendering worldTime 0', () => {
    expect(formatWorldTime(0, EARTH_GREGORIAN, { year: 1247, day: 1 })).toBe(
      'January 1, 1247 AD 00:00',
    )
  })
  // Single-digit on BOTH clock tiers: the unpadded template renders '1:5' here.
  it('zero-pads the clock tiers to two digits', () => {
    const ONE_HOUR_FIVE = 3600 + 5 * 60
    expect(formatWorldTime(ONE_HOUR_FIVE, EARTH_GREGORIAN, { year: 1247, day: 1 })).toBe(
      'January 1, 1247 AD 01:05',
    )
  })
  it('renders one instant identically from a partial origin at zero and from an offset', () => {
    const partial = { year: 1247, day: 1 }
    const dayBefore = { year: 1246, month: 12, day: 31, hour: 0, minute: 0, second: 0 }
    const ONE_DAY = 86_400
    expect(formatWorldTime(ONE_DAY, EARTH_GREGORIAN, dayBefore)).toBe(
      formatWorldTime(0, EARTH_GREGORIAN, partial),
    )
    expect(formatWorldTime(ONE_DAY, EARTH_GREGORIAN, partial)).toBe('January 2, 1247 AD 00:00')
  })
  it('returns a typed miss on a broken template rather than throwing to the caller', () => {
    const broken = { ...EARTH_GREGORIAN, displayFormat: '{% badtag %}' }
    const out = formatWorldTime(0, broken, ORIGIN)
    expect(out).toBeInstanceOf(FormatMiss)
  })
})
