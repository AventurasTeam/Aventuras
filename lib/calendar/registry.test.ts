import { describe, expect, it } from 'vitest'

import { getCalendar, listCalendars } from './registry'

describe('calendar registry', () => {
  it('resolves the earth-gregorian built-in by id', () => {
    expect(getCalendar('earth-gregorian')?.id).toBe('earth-gregorian')
  })
  it('returns undefined for unknown ids (no vault merge in M2)', () => {
    expect(getCalendar('nonexistent')).toBeUndefined()
  })
  it('lists the built-ins', () => {
    expect(listCalendars().map((c) => c.id)).toContain('earth-gregorian')
  })
})
