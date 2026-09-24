import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import type { CalendarSystem } from './calendar-schema'
import { largestWholeTier } from './elapsed'

const DAY = 86_400
const HOUR = 3_600

// Every tier constant, and a 60-second base unit: the top tier is reachable and spans floor.
const RING: CalendarSystem = {
  id: 'ring',
  name: 'Ring',
  baseUnitName: 'tick',
  secondsPerBaseUnit: 60,
  tiers: [
    { name: 'cycle', startValue: 0, rollover: { kind: 'constant', value: 1000 } },
    { name: 'turn', startValue: 0, rollover: { kind: 'constant', value: 10 } },
    { name: 'tick', startValue: 0, rollover: { kind: 'constant', value: 100 } },
  ],
  exampleStartValue: { cycle: 0, turn: 0, tick: 0 },
  displayFormat: '{{ cycle }}',
  eras: null,
}

describe('largestWholeTier', () => {
  it('reads Gregorian spans in days, never months', () => {
    expect(largestWholeTier(EARTH_GREGORIAN, 3 * DAY + 5 * HOUR)).toEqual({ tier: 'day', count: 3 })
    expect(largestWholeTier(EARTH_GREGORIAN, 400 * DAY)).toEqual({ tier: 'day', count: 400 })
  })

  it('drops to the largest tier that fits', () => {
    expect(largestWholeTier(EARTH_GREGORIAN, 5 * HOUR + 59)).toEqual({ tier: 'hour', count: 5 })
    expect(largestWholeTier(EARTH_GREGORIAN, 59)).toEqual({ tier: 'second', count: 59 })
  })

  it('reports zero of the smallest tier for no elapsed time', () => {
    expect(largestWholeTier(EARTH_GREGORIAN, 0)).toEqual({ tier: 'second', count: 0 })
  })

  it('returns null for a negative or non-numeric span', () => {
    expect(largestWholeTier(EARTH_GREGORIAN, -1)).toBeNull()
    expect(largestWholeTier(EARTH_GREGORIAN, Number.NaN)).toBeNull()
  })

  it('reaches the top tier of an all-constant calendar and floors in base units', () => {
    expect(largestWholeTier(RING, 3 * 1000 * 60)).toEqual({ tier: 'cycle', count: 3 })
    expect(largestWholeTier(RING, 90)).toEqual({ tier: 'tick', count: 1 })
    expect(largestWholeTier(RING, 30)).toEqual({ tier: 'tick', count: 0 })
  })
})
