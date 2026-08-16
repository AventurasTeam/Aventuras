import type { CalendarSystem, TierTuple } from './calendar-schema'

/**
 * The two values every world-time conversion needs together — a calendar cannot
 * render a label without an origin, and an origin is meaningless without the
 * calendar. Paired so consumers check presence once, and so a memoized frame
 * gives both halves one stable identity to key on.
 */
export type CalendarFrame = { calendar: CalendarSystem; origin: TierTuple }
