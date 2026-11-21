import { useMemo } from 'react'

import { resolveCalendar, type CalendarFrame, type TierTuple } from '@/lib/calendar'

/** The story's calendar and origin as one frame of stable identity, or null while either is unset. */
export function useCalendarFrame(
  calendarSystemId: string | null | undefined,
  origin: TierTuple | null | undefined,
): CalendarFrame | null {
  return useMemo(
    () =>
      calendarSystemId == null || origin == null
        ? null
        : { calendar: resolveCalendar(calendarSystemId), origin },
    [calendarSystemId, origin],
  )
}
