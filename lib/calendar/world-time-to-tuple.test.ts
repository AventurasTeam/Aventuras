import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import { FIXTURE_RULE_CALENDAR } from './builtins/fixtures'
import type { CalendarSystem } from './calendar-schema'
import {
  __cacheSize,
  __originComputeCount,
  __resetCache,
  tierMax,
  worldTimeToTuple,
} from './world-time-to-tuple'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

describe('worldTimeToTuple (earth-gregorian)', () => {
  it('anchors worldTime=0 to the origin', () => {
    expect(worldTimeToTuple(0, EARTH_GREGORIAN, ORIGIN)).toEqual(ORIGIN)
  })

  it('advances one day (86400s)', () => {
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, ORIGIN)).toEqual({
      year: 2024,
      month: 1,
      day: 2,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('rolls a full 31-day January into February (month table rollover)', () => {
    expect(worldTimeToTuple(31 * 86_400, EARTH_GREGORIAN, ORIGIN)).toEqual({
      year: 2024,
      month: 2,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('applies Gregorian leap: 2024 is leap (div4), Feb has 29 days', () => {
    expect(worldTimeToTuple(59 * 86_400, EARTH_GREGORIAN, ORIGIN)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('applies the /100 exclusion: 1900 is NOT leap', () => {
    const o1900 = { year: 1900, month: 2, day: 28, hour: 0, minute: 0, second: 0 }
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, o1900)).toEqual({
      year: 1900,
      month: 3,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('applies the /400 re-inclusion: 2000 IS leap', () => {
    const o2000 = { year: 2000, month: 2, day: 28, hour: 0, minute: 0, second: 0 }
    expect(worldTimeToTuple(86_400, EARTH_GREGORIAN, o2000)).toEqual({
      year: 2000,
      month: 2,
      day: 29,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('carries hours/minutes/seconds', () => {
    expect(worldTimeToTuple(3_661, EARTH_GREGORIAN, ORIGIN)).toEqual({
      year: 2024,
      month: 1,
      day: 1,
      hour: 1,
      minute: 1,
      second: 1,
    })
  })

  it('memoizes the origin conversion and populates the year cost cache', () => {
    __resetCache()
    expect(__cacheSize()).toBe(0)
    expect(__originComputeCount()).toBe(0)

    const a = worldTimeToTuple(400 * 86_400, EARTH_GREGORIAN, ORIGIN)
    expect(__cacheSize()).toBeGreaterThan(0)
    expect(__originComputeCount()).toBe(1)

    const b = worldTimeToTuple(400 * 86_400, EARTH_GREGORIAN, ORIGIN)
    expect(b).toEqual(a)
    // Same origin => memo hit, no second base-unit computation.
    expect(__originComputeCount()).toBe(1)
  })
})

describe('tierMax', () => {
  const ctx = { year: 2024, month: 2, day: 1, hour: 0, minute: 0, second: 0 }

  it('returns constant-tier maxima (hour → 23, minute/second → 59)', () => {
    expect(tierMax(EARTH_GREGORIAN, 'hour', ctx)).toBe(23)
    expect(tierMax(EARTH_GREGORIAN, 'minute', ctx)).toBe(59)
    expect(tierMax(EARTH_GREGORIAN, 'second', ctx)).toBe(59)
    expect(tierMax(EARTH_GREGORIAN, 'month', ctx)).toBe(12)
  })

  it('resolves table-kind day length against the month + leap context', () => {
    expect(tierMax(EARTH_GREGORIAN, 'day', { ...ctx, month: 1 })).toBe(31)
    expect(tierMax(EARTH_GREGORIAN, 'day', { ...ctx, year: 2024, month: 2 })).toBe(29)
    expect(tierMax(EARTH_GREGORIAN, 'day', { ...ctx, year: 2023, month: 2 })).toBe(28)
  })

  it('resolves rule-kind year length across a leap boundary', () => {
    expect(tierMax(FIXTURE_RULE_CALENDAR, 'day', { year: 1, day: 1 })).toBe(365)
    expect(tierMax(FIXTURE_RULE_CALENDAR, 'day', { year: 4, day: 1 })).toBe(366)
  })

  it('throws for an unknown tier name', () => {
    expect(() => tierMax(EARTH_GREGORIAN, 'fortnight', ctx)).toThrow(/Unknown tier/)
  })
})

describe('worldTimeToTuple (rule-kind rollover)', () => {
  it('derives year length from base + evalLeap across a leap boundary', () => {
    // Year 1 is non-leap (365 days): +365 days rolls into year 2.
    expect(worldTimeToTuple(365 * 86_400, FIXTURE_RULE_CALENDAR, { year: 1, day: 1 })).toEqual({
      year: 2,
      day: 1,
    })
    // Year 4 is leap (366 days): +365 days lands on day 366, no rollover.
    expect(worldTimeToTuple(365 * 86_400, FIXTURE_RULE_CALENDAR, { year: 4, day: 1 })).toEqual({
      year: 4,
      day: 366,
    })
    // +366 days from a leap year rolls into year 5.
    expect(worldTimeToTuple(366 * 86_400, FIXTURE_RULE_CALENDAR, { year: 4, day: 1 })).toEqual({
      year: 5,
      day: 1,
    })
  })
})

describe('worldTimeToTuple (degenerate zero-length tier)', () => {
  // A `rule` base of 1 with an always-matching `exclude` yields length 1 - 1 = 0,
  // making the top-tier cost zero. Before the guard this spun forever.
  const ZERO_COST_CALENDAR: CalendarSystem = {
    id: 'fixture-zero-cost',
    name: 'Zero Cost',
    baseUnitName: 'tick',
    secondsPerBaseUnit: 1,
    tiers: [
      { name: 'era', startValue: 0, rollover: { kind: 'constant', value: 10 } },
      {
        name: 'phase',
        startValue: 0,
        rollover: {
          kind: 'rule',
          against: 'era',
          base: 1,
          conditions: [{ every: 1, exclude: true }],
        },
      },
    ],
    exampleStartValue: { era: 0, phase: 0 },
    displayFormat: '{{ era }}:{{ phase }}',
    eras: null,
  }

  it('terminates and returns a tuple instead of looping forever', () => {
    __resetCache()
    expect(worldTimeToTuple(5, ZERO_COST_CALENDAR, { era: 0, phase: 0 })).toEqual({
      era: 0,
      phase: 5,
    })
  })
})
