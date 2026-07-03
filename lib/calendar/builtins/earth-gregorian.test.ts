import { describe, expect, it } from 'vitest'

import { calendarSystemSchema } from '../calendar-schema'
import { EARTH_GREGORIAN } from './earth-gregorian'
import { FIXTURE_ERA_CALENDAR } from './fixtures'

describe('earth-gregorian built-in', () => {
  it('is a valid CalendarSystem', () => {
    expect(() => calendarSystemSchema.parse(EARTH_GREGORIAN)).not.toThrow()
  })
  it('has id earth-gregorian and eras null', () => {
    expect(EARTH_GREGORIAN.id).toBe('earth-gregorian')
    expect(EARTH_GREGORIAN.eras).toBeNull()
  })
  it('the era fixture declares eras for arithmetic tests', () => {
    expect(calendarSystemSchema.parse(FIXTURE_ERA_CALENDAR).eras?.defaultStartName).toBeTruthy()
  })
})
