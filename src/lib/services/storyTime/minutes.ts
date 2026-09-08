/**
 * The one place the in-story calendar is defined: 60-minute hours, 24-hour days, 365-day
 * years.
 *
 * Repair scales durations. Doing that across four independent integer fields compounds
 * rounding at every unit, so everything converts to whole minutes, is scaled there, and
 * converts back once.
 */

import type { TimeTracker } from '$lib/types'

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY

/** Total minutes since the story's zero point. Partial trackers from older saves read as 0. */
export function toMinutes(time: TimeTracker): number {
  return (
    (time.years ?? 0) * MINUTES_PER_YEAR +
    (time.days ?? 0) * MINUTES_PER_DAY +
    (time.hours ?? 0) * MINUTES_PER_HOUR +
    (time.minutes ?? 0)
  )
}

/** The inverse of `toMinutes`. Negative totals clamp to zero: story time does not run before its start. */
export function fromMinutes(total: number): TimeTracker {
  let remaining = Math.max(0, Math.round(total))

  const years = Math.floor(remaining / MINUTES_PER_YEAR)
  remaining -= years * MINUTES_PER_YEAR
  const days = Math.floor(remaining / MINUTES_PER_DAY)
  remaining -= days * MINUTES_PER_DAY
  const hours = Math.floor(remaining / MINUTES_PER_HOUR)
  remaining -= hours * MINUTES_PER_HOUR

  return { years, days, hours, minutes: remaining }
}

/**
 * Carry overflow between units and borrow across underflow, clamping what is left negative.
 *
 * Kept distinct from `fromMinutes`: this accepts a tracker a caller assembled by hand — the
 * Time panel's four inputs, or an addition that overshot — where any field may be out of
 * range in either direction.
 */
export function normalizeTime(time: TimeTracker): TimeTracker {
  let { years, days, hours, minutes } = time

  while (minutes < 0 && hours > 0) {
    hours -= 1
    minutes += MINUTES_PER_HOUR
  }
  while (hours < 0 && days > 0) {
    days -= 1
    hours += 24
  }
  while (days < 0 && years > 0) {
    years -= 1
    days += 365
  }

  years = Math.max(0, years)
  days = Math.max(0, days)
  hours = Math.max(0, hours)
  minutes = Math.max(0, minutes)

  if (minutes >= MINUTES_PER_HOUR) {
    hours += Math.floor(minutes / MINUTES_PER_HOUR)
    minutes = minutes % MINUTES_PER_HOUR
  }
  if (hours >= 24) {
    days += Math.floor(hours / 24)
    hours = hours % 24
  }
  if (days >= 365) {
    years += Math.floor(days / 365)
    days = days % 365
  }

  return { years, days, hours, minutes }
}
