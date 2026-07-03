import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import type { CalendarSystem } from './calendar-schema'

const BUILTINS: readonly CalendarSystem[] = [EARTH_GREGORIAN]
const byId = new Map(BUILTINS.map((c) => [c.id, c]))

export const DEFAULT_CALENDAR_ID = 'earth-gregorian'

export function getCalendar(id: string): CalendarSystem | undefined {
  return byId.get(id)
}
export function listCalendars(): readonly CalendarSystem[] {
  return BUILTINS
}
