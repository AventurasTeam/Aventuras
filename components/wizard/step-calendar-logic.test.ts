import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN, type CalendarSystem } from '@/lib/calendar'

import {
  buildCalendarSummary,
  buildTierPath,
  computeSampleRender,
  preserveOriginOnSwap,
} from './step-calendar-logic'

// Subset of Earth's tiers — Shire Reckoning per wizard.md's calendar-swap
// examples (year/month/day only, no clock tiers).
const SHIRE: CalendarSystem = {
  id: 'shire-reckoning',
  name: 'Shire Reckoning',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86_400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    {
      name: 'month',
      startValue: 1,
      rollover: { kind: 'constant', value: 12 },
      labels: [
        'Afteryule',
        'Solmath',
        'Rethe',
        'Astron',
        'Thrimidge',
        'Forelithe',
        'Afterlithe',
        'Wedmath',
        'Halimath',
        'Winterfilth',
        'Blotmath',
        'Foreyule',
      ],
    },
    { name: 'day', startValue: 1, rollover: { kind: 'constant', value: 30 } },
  ],
  exampleStartValue: { year: 1, month: 1, day: 1 },
  displayFormat: '{{ day }} {{ monthName }}, {{ year }}',
  eras: null,
}

// Disjoint from Earth — single-tier Stardate-shaped calendar.
const STARDATE: CalendarSystem = {
  id: 'stardate',
  name: 'Stardate',
  baseUnitName: 'count',
  secondsPerBaseUnit: 1,
  tiers: [{ name: 'count', startValue: 0, rollover: { kind: 'constant', value: 100_000 } }],
  exampleStartValue: { count: 41000 },
  displayFormat: '{{ count }}',
  eras: null,
}

describe('preserveOriginOnSwap', () => {
  it('subset match (Earth → Shire): preserves overlapping tiers, drops the rest', () => {
    const prev = EARTH_GREGORIAN.exampleStartValue // {year,month,day,hour,minute,second}
    const result = preserveOriginOnSwap(prev, SHIRE)

    expect(result).toEqual({
      reset: false,
      origin: { year: 2024, month: 1, day: 1 },
    })
  })

  it('superset (Shire → Earth): preserves overlap, fills missing from exampleStartValue', () => {
    const prev = { year: 5, month: 3, day: 10 }
    const result = preserveOriginOnSwap(prev, EARTH_GREGORIAN)

    expect(result).toEqual({
      reset: false,
      origin: { year: 5, month: 3, day: 10, hour: 0, minute: 0, second: 0 },
    })
  })

  it('disjoint (Earth → Stardate): full reset to the target exampleStartValue', () => {
    const prev = EARTH_GREGORIAN.exampleStartValue
    const result = preserveOriginOnSwap(prev, STARDATE)

    expect(result).toEqual({ reset: true, origin: { count: 41000 } })
  })

  it('identity swap (same tier shape): no reset, values pass through unchanged', () => {
    const prev = { year: 2026, month: 7, day: 3, hour: 9, minute: 30, second: 0 }
    const result = preserveOriginOnSwap(prev, EARTH_GREGORIAN)

    expect(result).toEqual({ reset: false, origin: prev })
  })

  it('empty prev tuple (nothing seeded yet) is treated as fully disjoint', () => {
    const result = preserveOriginOnSwap({}, SHIRE)
    expect(result).toEqual({ reset: true, origin: { year: 1, month: 1, day: 1 } })
  })
})

describe('buildTierPath', () => {
  it('joins tier names top-down with an arrow separator', () => {
    expect(buildTierPath(EARTH_GREGORIAN)).toBe('year → month → day → hour → minute → second')
  })

  it('works for a single-tier calendar', () => {
    expect(buildTierPath(STARDATE)).toBe('count')
  })
})

describe('buildCalendarSummary', () => {
  it('describes each Earth tier via its child rollover, leaf tier as base unit', () => {
    const summary = buildCalendarSummary(EARTH_GREGORIAN)

    expect(summary.tiers).toEqual([
      { name: 'year', detail: { kind: 'constant', unitTierName: 'month', value: 12 } },
      { name: 'month', detail: { kind: 'table', unitTierName: 'day', min: 28, max: 31 } },
      { name: 'day', detail: { kind: 'constant', unitTierName: 'hour', value: 24 } },
      { name: 'hour', detail: { kind: 'constant', unitTierName: 'minute', value: 60 } },
      { name: 'minute', detail: { kind: 'constant', unitTierName: 'second', value: 60 } },
      { name: 'second', detail: { kind: 'base-unit' } },
    ])
  })

  it('single-tier calendar: its only tier has no child → base unit', () => {
    const summary = buildCalendarSummary(STARDATE)
    expect(summary.tiers).toEqual([{ name: 'count', detail: { kind: 'base-unit' } }])
  })

  it('subdivisions: none when no tier declares any', () => {
    expect(buildCalendarSummary(EARTH_GREGORIAN).subdivisions).toEqual({ kind: 'none' })
  })

  it('subdivisions: surfaces a weekday-shaped subdivision when present', () => {
    const withWeekday: CalendarSystem = {
      ...EARTH_GREGORIAN,
      tiers: EARTH_GREGORIAN.tiers.map((tier) =>
        tier.name === 'day'
          ? {
              ...tier,
              subdivisions: [
                {
                  name: 'weekday',
                  length: 7,
                  offset: 0,
                  labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                },
              ],
            }
          : tier,
      ),
    }

    expect(buildCalendarSummary(withWeekday).subdivisions).toEqual({
      kind: 'weekday',
      subdivisionName: 'weekday',
      hostTierName: 'day',
      first: 'Sun',
      last: 'Sat',
      length: 7,
    })
  })

  it('eras: disabled when the calendar has no eras', () => {
    expect(buildCalendarSummary(EARTH_GREGORIAN).eras).toEqual({ kind: 'disabled' })
  })

  it('eras: preset when presetNames is populated', () => {
    const withEras: CalendarSystem = {
      ...EARTH_GREGORIAN,
      eras: {
        flipMode: 'display-label',
        resetsOnFlip: ['year'],
        defaultStartName: 'First Age',
        presetNames: ['First Age', 'Second Age'],
      },
    }
    expect(buildCalendarSummary(withEras).eras).toEqual({
      kind: 'preset',
      names: ['First Age', 'Second Age'],
    })
  })

  it('eras: free-form when eras are enabled without a preset list', () => {
    const withEras: CalendarSystem = {
      ...EARTH_GREGORIAN,
      eras: {
        flipMode: 'display-label',
        resetsOnFlip: ['year'],
        defaultStartName: 'Year of the Founding',
      },
    }
    expect(buildCalendarSummary(withEras).eras).toEqual({ kind: 'freeform' })
  })

  it('a rule-kind child rollover surfaces the driving tier name', () => {
    const ruleCalendar: CalendarSystem = {
      id: 'rule-fixture',
      name: 'Rule fixture',
      baseUnitName: 'tick',
      secondsPerBaseUnit: 1,
      tiers: [
        { name: 'era', startValue: 1, rollover: { kind: 'constant', value: 1_000 } },
        {
          name: 'tick',
          startValue: 0,
          rollover: { kind: 'rule', against: 'era', base: 365, conditions: [{ every: 4 }] },
        },
      ],
      exampleStartValue: { era: 1, tick: 0 },
      displayFormat: '{{ tick }}',
      eras: null,
    }

    expect(buildCalendarSummary(ruleCalendar).tiers).toEqual([
      { name: 'era', detail: { kind: 'rule', unitTierName: 'tick', against: 'era' } },
      { name: 'tick', detail: { kind: 'base-unit' } },
    ])
  })
})

describe('computeSampleRender', () => {
  it('returns the formatted render once the origin is a fully valid tuple', () => {
    const rendered = computeSampleRender(EARTH_GREGORIAN, EARTH_GREGORIAN.exampleStartValue)
    expect(typeof rendered).toBe('string')
    expect(rendered).not.toBeNull()
  })

  it('returns null when the origin is empty (not picked yet)', () => {
    expect(computeSampleRender(EARTH_GREGORIAN, {})).toBeNull()
  })

  it('returns null when the origin is out of range for a tier', () => {
    expect(
      computeSampleRender(EARTH_GREGORIAN, {
        year: 2024,
        month: 13,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
      }),
    ).toBeNull()
  })
})
