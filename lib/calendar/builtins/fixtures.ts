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
