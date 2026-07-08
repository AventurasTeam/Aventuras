import { describe, expect, it } from 'vitest'

import { calendarSystemSchema } from './calendar-schema'

const EARTH_ISH = {
  id: 'earth-gregorian',
  name: 'Earth (Gregorian)',
  baseUnitName: 'second',
  secondsPerBaseUnit: 1,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    {
      name: 'month',
      startValue: 1,
      rollover: { kind: 'constant', value: 12 },
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
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
  displayFormat: '{{ year }}-{{ month }}-{{ day }}',
  eras: null,
}

describe('calendarSystemSchema', () => {
  it('parses a Gregorian-shaped definition including the day-tier leap augment', () => {
    const parsed = calendarSystemSchema.parse(EARTH_ISH)
    expect(parsed.tiers[2].rollover).toMatchObject({ kind: 'table', indexedBy: 'month' })
  })

  it('rejects a non-positive secondsPerBaseUnit', () => {
    expect(() => calendarSystemSchema.parse({ ...EARTH_ISH, secondsPerBaseUnit: 0 })).toThrow()
  })

  it('accepts an eras declaration', () => {
    const withEras = {
      ...EARTH_ISH,
      id: 'fixture-eras',
      eras: { flipMode: 'display-label', resetsOnFlip: ['year'], defaultStartName: 'First Age' },
    }
    expect(calendarSystemSchema.parse(withEras).eras?.defaultStartName).toBe('First Age')
  })

  it('rejects a definition whose exampleStartValue omits a tier key', () => {
    const { second: _second, ...partialOrigin } = EARTH_ISH.exampleStartValue
    expect(() =>
      calendarSystemSchema.parse({ ...EARTH_ISH, exampleStartValue: partialOrigin }),
    ).toThrow(/missing tier/)
  })
})
