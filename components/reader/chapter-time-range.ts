import { FormatMiss, formatWorldTime, type CalendarFrame } from '@/lib/calendar'
import type { ChapterTimeRange } from '@/lib/db'

/** One world time as the calendar renders it; null with no frame, a format miss or empty label. */
export function worldTimeLabel(seconds: number, frame: CalendarFrame | null): string | null {
  if (frame == null) return null
  const label = formatWorldTime(seconds, frame.calendar, frame.origin)
  return label instanceof FormatMiss || label === '' ? null : label
}

/** The UI can't parse the formatter's string, so "same day" reads as two equal labels. */
export function chapterTimeRangeLabel(
  range: ChapterTimeRange | undefined,
  frame: CalendarFrame | null,
): string | null {
  if (range == null) return null
  const first = worldTimeLabel(range.first, frame)
  const last = worldTimeLabel(range.last, frame)
  if (first == null || last == null) return null
  return first === last ? first : `${first} → ${last}`
}
