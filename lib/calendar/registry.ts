import { logger } from '@/lib/diagnostics'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import type { CalendarSystem } from './calendar-schema'

const BUILTINS: readonly CalendarSystem[] = [EARTH_GREGORIAN]
const byId = new Map(BUILTINS.map((c) => [c.id, c]))

// Read off the builtin, not spelled again: a typo would make every fallback miss.
export const DEFAULT_CALENDAR_ID = EARTH_GREGORIAN.id

// Per id, not per call: resolveCalendar runs unmemoized in render, so an unknown
// id would evict the whole 500-entry log buffer. Session-scoped — a reload re-reports.
const warnedUnknown = new Set<string>()

export function getCalendar(id: string): CalendarSystem | undefined {
  return byId.get(id)
}

/**
 * The calendar a story is configured with, or the default when its id is
 * unknown — total by construction, the fallback is the builtin itself. It is
 * logged because it is silent everywhere else: the prompt path requires
 * `calendarVocabulary`, so an unresolved id feeds the model Gregorian months
 * with nothing to branch on. Callers that would WRITE through the result use
 * `getCalendar` and degrade instead.
 */
export function resolveCalendar(id: string): CalendarSystem {
  const found = byId.get(id)
  if (found) return found
  if (!warnedUnknown.has(id)) {
    warnedUnknown.add(id)
    logger.warn('calendar.unknown_id', { id, fallback: DEFAULT_CALENDAR_ID })
  }
  return EARTH_GREGORIAN
}

export function listCalendars(): readonly CalendarSystem[] {
  return BUILTINS
}
