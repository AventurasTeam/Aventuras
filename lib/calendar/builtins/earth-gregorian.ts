import type { CalendarSystem } from '../calendar-schema'

export const EARTH_GREGORIAN: CalendarSystem = {
  id: 'earth-gregorian',
  name: 'Earth (Gregorian)',
  baseUnitName: 'second',
  secondsPerBaseUnit: 1,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000_000 } },
    {
      name: 'month',
      startValue: 1,
      rollover: { kind: 'constant', value: 12 },
      labels: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
    },
    {
      name: 'day',
      startValue: 1,
      rollover: {
        kind: 'table',
        indexedBy: 'month',
        values: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        leap: {
          indexedBy: 'year',
          atIndex: 2,
          conditions: [{ every: 4 }, { every: 100, exclude: true }, { every: 400 }],
        },
      },
    },
    { name: 'hour', startValue: 0, rollover: { kind: 'constant', value: 24 } },
    { name: 'minute', startValue: 0, rollover: { kind: 'constant', value: 60 } },
    { name: 'second', startValue: 0, rollover: { kind: 'constant', value: 60 } },
  ],
  exampleStartValue: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
  displayFormat:
    '{{ monthName }} {{ day }}, {% if year < 1 %}{{ 1 | minus: year }} BC{% else %}{{ year }} AD{% endif %} {{ hour }}:{{ minute }}',
  eras: null,
}
