/**
 * Story Time
 *
 * Formatting for in-story time (`TimeTracker`) on the retrieval paths.
 *
 * Distinct from `formatStoryTime()` in NarrativeService, which always returns a value and
 * falls back to "Year 1, Day 1, 0 hours 0 minutes" when it has nothing. That is right for
 * the narrator prompt, which needs a current time no matter what, and wrong here: in
 * retrieved material "I don't know when this happened" and "this happened at the very
 * beginning of the story" are different claims, and printing the second when you mean the
 * first is a lie the narrator will build on. These helpers return `null` for unknown and
 * leave it to the caller to say so.
 *
 * The format is also more compact -- `Year 1, Day 4, 14:30` rather than `... 14 hours 30
 * minutes`. Retrieval stamps time per entry, not once per prompt, so the long form is
 * paid over and over.
 */

import type { Chapter, StoryEntry, TimeTracker } from '$lib/types'

/**
 * `Year 1, Day 4, 14:30`, or null when the time is not known.
 *
 * Both clock fields are zero-padded. The hours were not, which produced `9:05` beside
 * `14:30` in the same excerpt list -- and the agent is asked to judge recency by comparing
 * these stamps against "now", which a ragged field width makes harder than it needs to be.
 */
export function formatStoryTimeOrNull(time: TimeTracker | null | undefined): string | null {
  if (!time) return null
  const hours = String(time.hours).padStart(2, '0')
  const minutes = String(time.minutes).padStart(2, '0')
  return `Year ${time.years + 1}, Day ${time.days + 1}, ${hours}:${minutes}`
}

function sameInstant(
  a: TimeTracker | null | undefined,
  b: TimeTracker | null | undefined,
): boolean {
  if (!a || !b) return false
  return a.years === b.years && a.days === b.days && a.hours === b.hours && a.minutes === b.minutes
}

/**
 * A span as `start → end`, collapsed to a single instant when the two match (most
 * entries, and any chapter where no time passed). Null when neither end is known.
 */
export function formatTimeSpan(
  start: TimeTracker | null | undefined,
  end: TimeTracker | null | undefined,
): string | null {
  const from = formatStoryTimeOrNull(start)
  const to = formatStoryTimeOrNull(end)

  if (from && to) return sameInstant(start, end) ? from : `${from} → ${to}`
  return from ?? to
}

/** When a chapter's own recorded span is unavailable. */
export type TimeConfidence = 'exact' | 'approximate' | 'unknown'

export interface EntryTime {
  label: string | null
  confidence: TimeConfidence
}

export interface EntryTimeSpan {
  start: TimeTracker | null
  end: TimeTracker | null
  confidence: TimeConfidence
}

/**
 * The raw span an entry occupies.
 *
 * Entries written before time tracking existed carry no `timeStart`/`timeEnd`, so rather
 * than reporting nothing we fall back to the span of the chapter containing them --
 * marked `approximate`, because "somewhere inside this chapter" is genuinely weaker than
 * a recorded stamp and the caller should be able to say which it has.
 */
function resolveEntryTimeSpan(entry: StoryEntry, chapter?: Chapter | null): EntryTimeSpan {
  const start = entry.metadata?.timeStart ?? null
  const end = entry.metadata?.timeEnd ?? null
  if (start || end) return { start: start ?? end, end: end ?? start, confidence: 'exact' }

  if (chapter && (chapter.startTime || chapter.endTime)) {
    // Half-recorded chapter spans stay half-recorded rather than being squared off from
    // the bound that exists: "started here, end unknown" is what a chapter with only a
    // startTime says, and squaring it off would turn a chapter spanning days into an
    // instant. The entry's own stamp above is a moment and is left alone.
    return {
      start: chapter.startTime ?? null,
      end: chapter.endTime ?? null,
      confidence: 'approximate',
    }
  }

  return { start: null, end: null, confidence: 'unknown' }
}

/** When a single story entry happened, formatted. See `resolveEntryTimeSpan`. */
export function entryTime(entry: StoryEntry, chapter?: Chapter | null): EntryTime {
  const { start, end, confidence } = resolveEntryTimeSpan(entry, chapter)
  return { label: formatTimeSpan(start, end), confidence }
}

/** `entryTime` rendered for a prompt: `[Year 1, Day 4, 14:30]`, `[~ …]`, or `[time unknown]`. */
export function entryTimeTag(entry: StoryEntry, chapter?: Chapter | null): string {
  const { label, confidence } = entryTime(entry, chapter)
  if (!label) return '[time unknown]'
  return confidence === 'approximate' ? `[~${label}]` : `[${label}]`
}
