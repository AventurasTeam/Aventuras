import { describe, it, expect } from 'vitest'
import { toMinutes, fromMinutes, normalizeTime } from './minutes'

describe('toMinutes', () => {
  it('applies the 365-day year and 24-hour day', () => {
    expect(toMinutes({ years: 0, days: 0, hours: 0, minutes: 0 })).toBe(0)
    expect(toMinutes({ years: 0, days: 0, hours: 1, minutes: 30 })).toBe(90)
    expect(toMinutes({ years: 0, days: 1, hours: 0, minutes: 0 })).toBe(1440)
    expect(toMinutes({ years: 1, days: 0, hours: 0, minutes: 0 })).toBe(365 * 1440)
  })

  it('reads a partial tracker from an older save as zero in the missing fields', () => {
    const partial = { hours: 2, minutes: 15 } as unknown as Parameters<typeof toMinutes>[0]
    expect(toMinutes(partial)).toBe(135)
  })
})

describe('fromMinutes', () => {
  it('round-trips every unit', () => {
    const cases = [
      { years: 0, days: 0, hours: 0, minutes: 0 },
      { years: 0, days: 0, hours: 0, minutes: 59 },
      { years: 0, days: 0, hours: 23, minutes: 59 },
      { years: 0, days: 364, hours: 23, minutes: 59 },
      { years: 3, days: 200, hours: 7, minutes: 42 },
    ]
    for (const time of cases) {
      expect(fromMinutes(toMinutes(time))).toEqual(time)
    }
  })

  it('clamps a negative total to zero', () => {
    expect(fromMinutes(-90)).toEqual({ years: 0, days: 0, hours: 0, minutes: 0 })
  })

  it('rounds a fractional total to the nearest minute', () => {
    expect(fromMinutes(90.4)).toEqual({ years: 0, days: 0, hours: 1, minutes: 30 })
    expect(fromMinutes(90.6)).toEqual({ years: 0, days: 0, hours: 1, minutes: 31 })
  })
})

describe('normalizeTime', () => {
  it('carries overflow up through the units', () => {
    expect(normalizeTime({ years: 0, days: 0, hours: 0, minutes: 1500 })).toEqual({
      years: 0,
      days: 1,
      hours: 1,
      minutes: 0,
    })
    expect(normalizeTime({ years: 0, days: 365, hours: 0, minutes: 0 })).toEqual({
      years: 1,
      days: 0,
      hours: 0,
      minutes: 0,
    })
  })

  it('borrows one unit down and clamps what is left negative', () => {
    expect(normalizeTime({ years: 0, days: 0, hours: 2, minutes: -30 })).toEqual({
      years: 0,
      days: 0,
      hours: 1,
      minutes: 30,
    })
    expect(normalizeTime({ years: 0, days: 0, hours: 0, minutes: -30 })).toEqual({
      years: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    })
  })

  // A borrow does not cascade: minutes come from hours only, so an hour-less tracker clamps
  // rather than reaching into days. Reconciliation converts through `fromMinutes` instead and
  // never depends on this.
  it('does not cascade a borrow past the next unit up', () => {
    expect(normalizeTime({ years: 0, days: 1, hours: 0, minutes: -30 })).toEqual({
      years: 0,
      days: 1,
      hours: 0,
      minutes: 0,
    })
  })

  it('agrees with the minutes round-trip for values that are already in range', () => {
    const time = { years: 2, days: 40, hours: 5, minutes: 6 }
    expect(normalizeTime(time)).toEqual(fromMinutes(toMinutes(time)))
  })
})
