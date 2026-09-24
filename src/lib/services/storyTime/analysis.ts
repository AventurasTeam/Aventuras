/**
 * Read-only analysis of a story's recorded chronology.
 *
 * Nothing here writes. Findings carry a severity, and the distinction matters more than the
 * list: a *defect* is provable from the stored data, a *suspected* one is worth a look and may
 * well be fine. See docs/architecture/story-time.md.
 */

import type { Chapter, StoryEntry, TimeTracker } from '$lib/types'
import { toMinutes } from './minutes'

/** An entry shorter than this whose clock jumps a day or more is worth a look. */
export const IMPLAUSIBLE_JUMP_MINUTES = 24 * 60
export const IMPLAUSIBLE_JUMP_MAX_WORDS = 200
/** Consecutive entries in which no time passes at all before it reads as a stalled clock. */
export const FLATLINE_RUN_LENGTH = 20

export type TimelineAnomalyKind =
  | 'missing-stamp'
  | 'suspect-zero'
  | 'backwards'
  | 'reversed'
  | 'overlap'
  | 'gap'
  | 'implausible-jump'
  | 'flatline'
  | 'chapter-span-disagreement'

/** How much a finding is worth to the reader. */
export type TimelineSeverity = 'defect' | 'suspected'

export interface TimelineAnomaly {
  kind: TimelineAnomalyKind
  /** Where it is. A pair for anomalies that are about a join rather than an entry. */
  entryIds: string[]
  chapterId?: string
  detail: string
  severity: TimelineSeverity
}

export interface TimelineAnalysisInput {
  entries: StoryEntry[]
  chapters?: Chapter[]
}

function ending(entry: StoryEntry): TimeTracker | null {
  return entry.metadata?.timeEnd ?? null
}

function beginning(entry: StoryEntry): TimeTracker | null {
  return entry.metadata?.timeStart ?? null
}

function isZero(time: TimeTracker): boolean {
  return toMinutes(time) === 0
}

function wordCount(entry: StoryEntry): number {
  return entry.content.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Every anomaly in a story's timeline.
 *
 * A zero stamp is reported as *suspect*, never as fabricated: `addEntry` writes the same
 * zero for a legitimately zero clock and for an absent one, so the stored value cannot tell
 * them apart. An entry with no stamp at all is a separate class: an unknown duration is not a
 * recorded zero.
 */
export function analyzeTimeline(input: TimelineAnalysisInput): TimelineAnomaly[] {
  const { entries, chapters = [] } = input
  const anomalies: TimelineAnomaly[] = []

  for (const entry of entries) {
    const end = ending(entry)
    const start = beginning(entry)

    if (!end && !start) {
      anomalies.push({
        kind: 'missing-stamp',
        entryIds: [entry.id],
        detail: 'No in-story time is recorded for this entry.',
        severity: 'defect',
      })
      continue
    }

    if (end && isZero(end) && (!start || isZero(start))) {
      anomalies.push({
        kind: 'suspect-zero',
        entryIds: [entry.id],
        detail:
          'Recorded at zero. A zero clock and an absent one are written identically, so this may be a real time or no time at all.',
        severity: 'suspected',
      })
    }

    // Measured inside the entry, not across the interval before it: a day passing during three
    // words is suspicious, a day passing between two scenes is a skip.
    if (start && end) {
      const elapsed = toMinutes(end) - toMinutes(start)
      if (elapsed < 0) {
        anomalies.push({
          kind: 'reversed',
          entryIds: [entry.id],
          detail: 'This entry ends before it begins.',
          severity: 'defect',
        })
      } else if (
        elapsed >= IMPLAUSIBLE_JUMP_MINUTES &&
        wordCount(entry) < IMPLAUSIBLE_JUMP_MAX_WORDS
      ) {
        anomalies.push({
          kind: 'implausible-jump',
          entryIds: [entry.id],
          detail: `${elapsed} minutes pass within ${wordCount(entry)} words.`,
          severity: 'suspected',
        })
      }
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1]
    const entry = entries[i]
    const previousEnd = ending(previous)
    const end = ending(entry)
    const start = beginning(entry)

    if (previousEnd && end && toMinutes(end) < toMinutes(previousEnd)) {
      anomalies.push({
        kind: 'backwards',
        entryIds: [previous.id, entry.id],
        detail: 'This entry ends before the one before it.',
        severity: 'defect',
      })
    }

    // An interval is a legitimate skip as often as a lost stretch, so it is only suspected. An
    // entry beginning *before* the previous one ended is wrong.
    if (previousEnd && start && toMinutes(start) > toMinutes(previousEnd)) {
      anomalies.push({
        kind: 'gap',
        entryIds: [previous.id, entry.id],
        detail: `${toMinutes(start) - toMinutes(previousEnd)} minutes pass between these two entries, not claimed by either of them.`,
        severity: 'suspected',
      })
    }

    if (previousEnd && start && toMinutes(start) < toMinutes(previousEnd)) {
      anomalies.push({
        kind: 'overlap',
        entryIds: [previous.id, entry.id],
        detail: 'This entry begins before the entry before it ended.',
        severity: 'defect',
      })
    }
  }

  anomalies.push(...flatlines(entries))
  anomalies.push(...chapterSpanDisagreements(entries, chapters))

  return anomalies
}

/** Runs where the clock never moves, reported once per run rather than once per entry. */
function flatlines(entries: StoryEntry[]): TimelineAnomaly[] {
  const found: TimelineAnomaly[] = []
  let run: StoryEntry[] = []

  const flush = () => {
    if (run.length >= FLATLINE_RUN_LENGTH) {
      found.push({
        kind: 'flatline',
        entryIds: run.map((e) => e.id),
        detail: `${run.length} consecutive entries in which no time passes.`,
        severity: 'suspected',
      })
    }
    run = []
  }

  for (let i = 1; i < entries.length; i++) {
    const previousEnd = ending(entries[i - 1])
    const end = ending(entries[i])
    if (previousEnd && end && toMinutes(end) === toMinutes(previousEnd)) {
      if (run.length === 0) run.push(entries[i - 1])
      run.push(entries[i])
    } else {
      flush()
    }
  }
  flush()

  return found
}

/**
 * Chapters whose stored span no longer matches the entries they cover.
 *
 * The span is a copy taken when the chapter was written and never revalidated, so it drifts
 * whenever those entries move.
 */
function chapterSpanDisagreements(entries: StoryEntry[], chapters: Chapter[]): TimelineAnomaly[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const found: TimelineAnomaly[] = []

  for (const chapter of chapters) {
    const first = byId.get(chapter.startEntryId)
    const last = byId.get(chapter.endEntryId)
    if (!first || !last) continue

    const expectedStart = beginning(first)
    const expectedEnd = ending(last)
    const disagrees =
      (expectedStart &&
        chapter.startTime &&
        toMinutes(expectedStart) !== toMinutes(chapter.startTime)) ||
      (expectedEnd && chapter.endTime && toMinutes(expectedEnd) !== toMinutes(chapter.endTime))

    if (disagrees) {
      found.push({
        kind: 'chapter-span-disagreement',
        entryIds: [chapter.startEntryId, chapter.endEntryId],
        chapterId: chapter.id,
        detail: `Chapter ${chapter.number}'s recorded span does not match the entries it covers.`,
        severity: 'defect',
      })
    }
  }

  return found
}
