/**
 * Reading and writing a duration the reader typed.
 *
 * One field rather than four boxes: an entry can span a season, so the input has to hold
 * anything from `15` to `2y 40d` without a box overflowing or the reader tabbing through
 * units they do not need. Parsing lives outside the component so it can be tested — a number
 * input binds a *number* rather than a string, and getting that wrong is invisible to
 * `svelte-check`.
 */

import { toMinutes } from './minutes'

const MINUTES_PER = {
  y: 365 * 24 * 60,
  d: 24 * 60,
  h: 60,
  m: 1,
} as const

/** `3d 4h 30m`, `90`, `2h`, `1y 2d`. A bare number reads as minutes. */
const TOKENS = /^(\d+)\s*([ydhm])$/
const BARE_NUMBER = /^\d+$/

/**
 * Total minutes, or null when the text is not a duration.
 *
 * Empty is null rather than zero: an unset field is unanswered, not an assertion that nothing
 * elapsed. An explicit `0` is an answer, since a zero-length entry is a legitimate claim.
 */
export function parseDuration(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const trimmed = String(text).trim().toLowerCase()
  if (trimmed === '') return null

  if (BARE_NUMBER.test(trimmed)) return Number(trimmed)

  // Split on whitespace, and also between a digit and a letter so `3d4h` reads the same as
  // `3d 4h`.
  const parts = trimmed.replace(/([ydhm])(?=\d)/g, '$1 ').split(/\s+/)
  let total = 0
  const seen = new Set<string>()

  for (const part of parts) {
    const match = TOKENS.exec(part)
    if (!match) return null
    const [, amount, unit] = match
    if (seen.has(unit)) return null
    seen.add(unit)
    total += Number(amount) * MINUTES_PER[unit as keyof typeof MINUTES_PER]
  }

  return total
}

/** `3d 4h 30m`. The inverse of `parseDuration` for the values it produces. */
export function formatDuration(total: number): string {
  if (total <= 0) return '0m'
  const years = Math.floor(total / MINUTES_PER.y)
  const days = Math.floor((total % MINUTES_PER.y) / MINUTES_PER.d)
  const hours = Math.floor((total % MINUTES_PER.d) / MINUTES_PER.h)
  const minutes = total % MINUTES_PER.h

  return (
    [
      years ? `${years}y` : '',
      days ? `${days}d` : '',
      hours ? `${hours}h` : '',
      minutes ? `${minutes}m` : '',
    ]
      .filter(Boolean)
      .join(' ') || '0m'
  )
}

/** True when something has been typed that cannot be read as a duration. */
export function durationIsInvalid(text: string | null | undefined): boolean {
  if (text === null || text === undefined || String(text).trim() === '') return false
  return parseDuration(text) === null
}

/** A duration expressed as a `TimeTracker`, for callers that speak in the four units. */
export function durationFromTracker(time: {
  years?: number
  days?: number
  hours?: number
  minutes?: number
}): number {
  return toMinutes({
    years: time.years ?? 0,
    days: time.days ?? 0,
    hours: time.hours ?? 0,
    minutes: time.minutes ?? 0,
  })
}

/**
 * An absolute point on the story's clock, as the interface writes it: `Y1 D4 14:30`.
 *
 * Displayed years and days are one-based, since a reader counts the first day as day one
 * while the tracker counts elapsed days from zero. Parsing and formatting both go through
 * that offset so the figure typed back is the figure shown.
 */
const STORY_TIME = /^(?:y\s*(\d+)\s+)?(?:d\s*(\d+)\s+)?(\d{1,3}):([0-5]\d)$/

export function parseStoryTime(text: string | null | undefined): {
  years: number
  days: number
  hours: number
  minutes: number
} | null {
  if (text === null || text === undefined) return null
  const match = STORY_TIME.exec(String(text).trim().toLowerCase().replace(/\s+/g, ' '))
  if (!match) return null

  const [, year, day, hours, minutes] = match
  const displayedYear = year === undefined ? 1 : Number(year)
  const displayedDay = day === undefined ? 1 : Number(day)
  if (displayedYear < 1 || displayedDay < 1) return null
  if (Number(hours) > 23) return null

  return {
    years: displayedYear - 1,
    days: displayedDay - 1,
    hours: Number(hours),
    minutes: Number(minutes),
  }
}

/** `Y1 D4 14:30`. The inverse of `parseStoryTime`. */
export function formatStoryTime(time: {
  years?: number
  days?: number
  hours?: number
  minutes?: number
}): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Y${(time.years ?? 0) + 1} D${(time.days ?? 0) + 1} ${pad(time.hours ?? 0)}:${pad(time.minutes ?? 0)}`
}

/** True when something has been typed that is not a story time. */
export function storyTimeIsInvalid(text: string | null | undefined): boolean {
  if (text === null || text === undefined || String(text).trim() === '') return false
  return parseStoryTime(text) === null
}
