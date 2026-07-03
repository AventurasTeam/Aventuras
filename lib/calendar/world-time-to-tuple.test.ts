import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import { worldTimeToTuple, __cacheSize } from './world-time-to-tuple'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

describe('worldTimeToTuple (earth-gregorian)', () => {
  it('anchors worldTime=0 to the origin', () => {
    expect(worldTimeToTuple(0, EARTH_GREGORIAN, ORIGIN)).toEqual(ORIGIN)
  })

  it('advances one day (86400s)', () => {
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, ORIGIN)).toMatchObject({
      year: 2024,
      month: 1,
      day: 2,
    })
  })

  it('rolls a full 31-day January into February (month table rollover)', () => {
    expect(worldTimeToTuple(31 * 86_400, EARTH_GREGORIAN, ORIGIN)).toMatchObject({
      year: 2024,
      month: 2,
      day: 1,
    })
  })

  it('applies Gregorian leap: 2024 is leap (div4), Feb has 29 days', () => {
    expect(worldTimeToTuple(59 * 86_400, EARTH_GREGORIAN, ORIGIN)).toMatchObject({
      year: 2024,
      month: 2,
      day: 29,
    })
  })

  it('applies the /100 exclusion: 1900 is NOT leap', () => {
    const o1900 = { year: 1900, month: 2, day: 28, hour: 0, minute: 0, second: 0 }
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, o1900)).toMatchObject({
      year: 1900,
      month: 3,
      day: 1,
    })
  })

  it('applies the /400 re-inclusion: 2000 IS leap', () => {
    const o2000 = { year: 2000, month: 2, day: 28, hour: 0, minute: 0, second: 0 }
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, o2000)).toMatchObject({
      year: 2000,
      month: 2,
      day: 29,
    })
  })

  it('carries hours/minutes/seconds', () => {
    expect(worldTimeToTuple(3_661, EARTH_GREGORIAN, ORIGIN)).toMatchObject({
      hour: 1,
      minute: 1,
      second: 1,
    })
  })

  it('per-year cache: repeated calls are equivalent and populate the cache', () => {
    const a = worldTimeToTuple(400 * 86_400, EARTH_GREGORIAN, ORIGIN)
    const before = __cacheSize()
    const b = worldTimeToTuple(400 * 86_400, EARTH_GREGORIAN, ORIGIN)
    expect(a).toEqual(b)
    expect(__cacheSize()).toBeGreaterThanOrEqual(before)
  })
})
