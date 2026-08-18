import type { CalendarSystem } from '../calendar-schema'

export const FIXTURE_ERA_CALENDAR: CalendarSystem = {
  id: 'fixture-eras',
  name: 'Fixture Eras',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    { name: 'day', startValue: 1, rollover: { kind: 'constant', value: 360 } },
  ],
  exampleStartValue: { year: 1, day: 1 },
  displayFormat: '{{ era }} {{ eraYear }}, day {{ day }}',
  eras: {
    flipMode: 'display-label',
    resetsOnFlip: ['year'],
    defaultStartName: 'First Age',
    presetNames: ['First Age', 'Second Age'],
  },
}

// A monthless calendar whose days-per-year come straight from a `rule`-kind
// rollover, so year length = base + evalLeap (365 / 366) exercises that branch.
export const FIXTURE_RULE_CALENDAR: CalendarSystem = {
  id: 'fixture-rule',
  name: 'Fixture Rule',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    {
      name: 'day',
      startValue: 1,
      rollover: {
        kind: 'rule',
        against: 'year',
        base: 365,
        conditions: [{ every: 4 }, { every: 100, exclude: true }, { every: 400 }],
      },
    },
  ],
  exampleStartValue: { year: 1, day: 1 },
  displayFormat: '{{ year }}-{{ day }}',
  eras: null,
}

// Leap periods that are coprime-ish (4 and 6), so the top-tier cost cycle is
// lcm = 12 rather than max = 6. Gregorian's 4/100/400 divide each other, which
// makes those two derivations agree and hides the difference.
export const FIXTURE_COPRIME_LEAP_CALENDAR: CalendarSystem = {
  id: 'fixture-coprime-leap',
  name: 'Fixture Coprime Leap',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    {
      name: 'day',
      startValue: 1,
      rollover: {
        kind: 'rule',
        against: 'year',
        base: 100,
        conditions: [{ every: 4 }, { every: 6 }],
      },
    },
  ],
  exampleStartValue: { year: 1, day: 1 },
  displayFormat: '{{ year }}-{{ day }}',
  eras: null,
}

// Per-year day counts from a `table` indexed by the top tier: a hand-listed
// sequence is not periodic, so the top-tier cost cycle cannot be derived and
// the conversion must fall back to walking.
export const FIXTURE_TABLE_BY_YEAR_CALENDAR: CalendarSystem = {
  id: 'fixture-table-by-year',
  name: 'Fixture Table By Year',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 4 } },
    {
      name: 'day',
      startValue: 1,
      rollover: { kind: 'table', indexedBy: 'year', values: [10, 20, 30] },
    },
  ],
  exampleStartValue: { year: 1, day: 1 },
  displayFormat: '{{ year }}-{{ day }}',
  eras: null,
}
