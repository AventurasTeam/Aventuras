import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import { formatWorldTime, FormatMiss } from './render'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

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
  it('returns a typed miss on a broken template rather than throwing to the caller', () => {
    const broken = { ...EARTH_GREGORIAN, displayFormat: '{% badtag %}' }
    const out = formatWorldTime(0, broken, ORIGIN)
    expect(out).toBeInstanceOf(FormatMiss)
  })
})
