import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import type { CalendarSystem } from './calendar-schema'

const BUILTINS: readonly CalendarSystem[] = [EARTH_GREGORIAN]
const byId = new Map(BUILTINS.map((c) => [c.id, c]))

export const DEFAULT_CALENDAR_ID = 'earth-gregorian'

export function getCalendar(id: string): CalendarSystem | undefined {
  return byId.get(id)
}
/**
 * The calendar a story is configured with, or the default when its id is
 * unknown. `DEFAULT_CALENDAR_ID` is always a builtin, so this is total — every
 * caller previously spelled the fallback out and then re-handled a `undefined`
 * that could not occur.
 */
export function resolveCalendar(id: string): CalendarSystem {
  return byId.get(id) ?? byId.get(DEFAULT_CALENDAR_ID)!
}

export function listCalendars(): readonly CalendarSystem[] {
  return BUILTINS
}
