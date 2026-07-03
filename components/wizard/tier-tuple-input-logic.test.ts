import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from '@/lib/calendar'

import { validateOriginTuple } from './tier-tuple-input-logic'

const VALID = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

describe('validateOriginTuple (earth-gregorian)', () => {
  it('accepts a valid Gregorian date', () => {
    expect(validateOriginTuple(VALID, EARTH_GREGORIAN)).toEqual({ ok: true })
  })

  it('rejects Feb 30 in a leap year — day tier, max 29', () => {
    const result = validateOriginTuple({ ...VALID, month: 2, day: 30 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'day', min: 1, max: 29 })
  })

  it('accepts Feb 29 in a leap year (2024, div4)', () => {
    expect(validateOriginTuple({ ...VALID, month: 2, day: 29 }, EARTH_GREGORIAN)).toEqual({
      ok: true,
    })
  })

  it('rejects Feb 29 in a non-leap year — day tier, max 28', () => {
    const result = validateOriginTuple({ ...VALID, year: 2023, month: 2, day: 29 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'day', min: 1, max: 28 })
  })

  it('rejects hour 24 — hour tier, max 23', () => {
    const result = validateOriginTuple({ ...VALID, hour: 24 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'hour', min: 0, max: 23 })
  })

  it('rejects minute 60 — minute tier, max 59', () => {
    const result = validateOriginTuple({ ...VALID, minute: 60 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'minute', min: 0, max: 59 })
  })

  it('rejects month 13 — month tier, max 12', () => {
    const result = validateOriginTuple({ ...VALID, month: 13 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'month', min: 1, max: 12 })
  })

  it('rejects month 0 — below the tier startValue', () => {
    const result = validateOriginTuple({ ...VALID, month: 0 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'month', min: 1, max: 12 })
  })

  it('rejects a non-integer value', () => {
    const result = validateOriginTuple({ ...VALID, day: 1.5 }, EARTH_GREGORIAN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.tier).toBe('day')
  })

  it('reports only the first invalid tier top-down when several are wrong', () => {
    // Month 13 is invalid; day 45 would also be invalid on its own, but the
    // day range can't even be computed against an out-of-range month, so
    // month must surface first.
    const result = validateOriginTuple({ ...VALID, month: 13, day: 45 }, EARTH_GREGORIAN)
    expect(result).toEqual({ ok: false, tier: 'month', min: 1, max: 12 })
  })
})
