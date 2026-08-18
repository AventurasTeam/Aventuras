import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import {
  FIXTURE_COPRIME_LEAP_CALENDAR,
  FIXTURE_RULE_CALENDAR,
  FIXTURE_TABLE_BY_YEAR_CALENDAR,
} from './builtins/fixtures'
import type { CalendarSystem } from './calendar-schema'
import {
  __cacheSize,
  __originComputeCount,
  __resetCache,
  tierMax,
  tupleToBaseUnits,
  tupleToWorldTime,
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

describe('tupleToWorldTime', () => {
  it('round-trips worldTimeToTuple losslessly on a seconds-grain calendar', () => {
    for (const w of [0, 45, 3_600, 86_400 * 400 + 3_661]) {
      const tuple = worldTimeToTuple(w, EARTH_GREGORIAN, ORIGIN)
      expect(tupleToWorldTime(tuple, EARTH_GREGORIAN, ORIGIN)).toBe(w)
    }
  })

  // The shape production actually stores: seeded stories omit the tiers below
  // day, so the inverse is only ever called against a partial origin.
  it('round-trips through a partial origin', () => {
    const partial = { year: 1247, day: 1 }
    for (const w of [0, 210, 86_400 + 3_661]) {
      const tuple = worldTimeToTuple(w, EARTH_GREGORIAN, partial)
      expect(tupleToWorldTime(tuple, EARTH_GREGORIAN, partial)).toBe(w)
    }
  })

  it('agrees with the completed form of the same partial origin', () => {
    const partial = { year: 1247, day: 1 }
    const completed = { year: 1247, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
    const tuple = worldTimeToTuple(210, EARTH_GREGORIAN, partial)
    expect(tupleToWorldTime(tuple, EARTH_GREGORIAN, partial)).toBe(
      tupleToWorldTime(tuple, EARTH_GREGORIAN, completed),
    )
  })

  it('returns -365 days for a tuple exactly one non-leap year before the origin', () => {
    const before = { ...ORIGIN, year: 2023 }
    expect(tupleToWorldTime(before, EARTH_GREGORIAN, ORIGIN)).toBe(-365 * 86_400)
  })

  it('truncates sub-base-unit remainders on a coarse-grain calendar', () => {
    const origin = { year: 1, day: 1 }
    // 1 day + 1 hour of seconds; the day-grain tuple cannot carry the hour.
    const w = 86_400 + 3_600
    const tuple = worldTimeToTuple(w, FIXTURE_RULE_CALENDAR, origin)
    expect(tupleToWorldTime(tuple, FIXTURE_RULE_CALENDAR, origin)).toBe(86_400)
  })

  it('maps the origin tuple itself to zero', () => {
    expect(tupleToWorldTime(ORIGIN, EARTH_GREGORIAN, ORIGIN)).toBe(0)
  })
})

// The top tier's per-unit cost repeats with period lcm(every...) — 400 for
// Gregorian's 4/100/400 leap rule — so the walk from the calendar epoch is
// replaced by cycle arithmetic. Expected values are computed from first
// principles (elapsed years x 365 + leap days) x 86400, never from the
// implementation.
describe('tupleToBaseUnits — top-tier cycle arithmetic', () => {
  const atYearStart = (year: number) => ({
    year,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  })

  it.each([
    [401, 12_622_780_800],
    [2024, 63_839_664_000],
    [202_456, 6_388_862_688_000],
    [2_024_561, 63_888_942_758_400],
  ])('converts year %i to its epoch offset', (year, expected) => {
    expect(tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(year))).toBe(expected)
  })

  // Structural proof that no epoch walk happens: a linear walk would memoize a
  // per-year cost for every year it visited, so the cache would hold ~202k
  // entries instead of one period.
  it('costs one period of top-tier lookups regardless of how large the year is', () => {
    __resetCache()
    tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(202_456))
    expect(__cacheSize()).toBe(400)

    __resetCache()
    tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(2_024_561))
    expect(__cacheSize()).toBe(400)
  })

  it('stays exact across a period boundary', () => {
    const before = tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(400))
    const after = tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(401))
    // Year 400 is a leap year (divisible by 400), so it contributes 366 days.
    expect(after - before).toBe(366 * 86_400)
  })

  it('stays exact for a non-leap century boundary', () => {
    const before = tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(300))
    const after = tupleToBaseUnits(EARTH_GREGORIAN, atYearStart(301))
    // Year 300 is divisible by 100 but not 400, so it is not a leap year.
    expect(after - before).toBe(365 * 86_400)
  })

  it('falls back to the walk for a calendar whose period cannot be derived', () => {
    const tuple: Record<string, number> = {}
    for (const tier of FIXTURE_RULE_CALENDAR.tiers) tuple[tier.name] = tier.startValue
    tuple[FIXTURE_RULE_CALENDAR.tiers[0].name] = FIXTURE_RULE_CALENDAR.tiers[0].startValue + 3
    expect(tupleToBaseUnits(FIXTURE_RULE_CALENDAR, tuple)).toBeGreaterThan(0)
  })

  // lcm(4, 6) = 12, max(4, 6) = 6. Years 1-12 of this calendar run
  // 100 x 12 + 5 leap days = 1205; a period of 6 would total 6 x 100 + 2 = 602
  // and double to 1204, one day short.
  it('derives the period as an lcm, not the widest condition', () => {
    expect(tupleToBaseUnits(FIXTURE_COPRIME_LEAP_CALENDAR, { year: 13, day: 1 })).toBe(1205)
    expect(tupleToBaseUnits(FIXTURE_COPRIME_LEAP_CALENDAR, { year: 25, day: 1 })).toBe(2410)
  })

  // A per-year table is not periodic, so the cycle must not be derived at all.
  // Years 1 and 2 are 10 and 20 days; treating year 1 as a repeating period
  // would give 20 instead of 30.
  it('walks rather than cycling when the top tier indexes a table', () => {
    expect(tupleToBaseUnits(FIXTURE_TABLE_BY_YEAR_CALENDAR, { year: 3, day: 1 })).toBe(30)
    expect(tupleToBaseUnits(FIXTURE_TABLE_BY_YEAR_CALENDAR, { year: 2, day: 1 })).toBe(10)
  })
})
