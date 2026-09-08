/**
 * Read-only analysis of a story's recorded chronology.
 *
 * Nothing here writes. Findings carry a severity, and the distinction matters more than the
 * list: a *defect* is provable from the stored data, a *suspected* one rests on a threshold, and
 * a *note* is neither — something real that the reader has to decide about, an interval between
 * two entries being the case that matters. See docs/architecture/story-time.md.
 */

import type { Chapter, StoryEntry, TimeAnchor, TimeTracker } from '$lib/types'
import { toMinutes, fromMinutes } from './minutes'

/** An entry shorter than this whose clock jumps a day or more is worth a look. */
export const IMPLAUSIBLE_JUMP_MINUTES = 24 * 60
export const IMPLAUSIBLE_JUMP_MAX_WORDS = 200
/** Consecutive entries in which no time passes at all before it reads as a stalled clock. */
export const FLATLINE_RUN_LENGTH = 20

export type TimelineAnomalyKind =
  | 'missing-stamp'
  | 'suspect-zero'
  | 'backwards'
  | 'overlap'
  | 'gap'
  | 'implausible-jump'
  | 'flatline'
  | 'chapter-span-disagreement'

/**
 * How much a finding is worth to the reader.
 *
 * `note` exists because an interval between two entries is neither provably wrong nor a guess:
 * it is time the story did not narrate, and only the reader knows whether that is a skip, an
 * entry that ran long, or a clock that was nudged.
 */
export type TimelineSeverity = 'defect' | 'suspected' | 'note'

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
 * Every anomaly in a story's timeline, in story order.
 *
 * A zero stamp is reported as *suspect*, never as fabricated: `addEntry` writes the same
 * zero for a legitimately zero clock and for an absent one, so the stored value cannot tell
 * them apart. An entry with no stamp at all is a separate class -- an unknown duration is
 * not a recorded zero, and collapsing the two is the confusion this report exists to expose.
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

    // An interval is reported so the reader knows there is something to decide about, not
    // because it is wrong. An entry beginning *before* the previous one ended is wrong.
    if (previousEnd && start && toMinutes(start) > toMinutes(previousEnd)) {
      anomalies.push({
        kind: 'gap',
        entryIds: [previous.id, entry.id],
        detail: `${toMinutes(start) - toMinutes(previousEnd)} minutes pass between these two entries, which the story does not narrate.`,
        severity: 'note',
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

    // Measured inside the entry, not across the interval before it: a day passing during three
    // words is suspicious, a day passing between two scenes is a skip.
    if (start && end) {
      const elapsed = toMinutes(end) - toMinutes(start)
      if (elapsed >= IMPLAUSIBLE_JUMP_MINUTES && wordCount(entry) < IMPLAUSIBLE_JUMP_MAX_WORDS) {
        anomalies.push({
          kind: 'implausible-jump',
          entryIds: [entry.id],
          detail: `${elapsed} minutes pass within ${wordCount(entry)} words.`,
          severity: 'suspected',
        })
      }
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

export interface AssertedBoundaryReport {
  /** The latest anchored entry, or null when nothing has been asserted. */
  entryId: string | null
  assertedTime: TimeTracker | null
  recordedTime: TimeTracker | null
  /** Whether the recorded ending agrees with the assertion. Null when there is nothing to compare. */
  agrees: boolean | null
  entriesAfter: number
  /** Time accumulated after the boundary, or null when the tail's stamps cannot support the sum. */
  elapsedAfter: TimeTracker | null
}

/**
 * How far the timeline has been asserted, and what lies past it.
 *
 * Deliberately not called "verified": an anchor can disagree with the stored time, two
 * anchors can contradict each other, and endpoints that agree say nothing about the pacing
 * interpolated between them.
 */
export function latestAssertedBoundary(
  entries: StoryEntry[],
  anchors: TimeAnchor[],
): AssertedBoundaryReport {
  const empty: AssertedBoundaryReport = {
    entryId: null,
    assertedTime: null,
    recordedTime: null,
    agrees: null,
    entriesAfter: 0,
    elapsedAfter: null,
  }
  if (anchors.length === 0) return empty

  const anchorByEntry = new Map(anchors.map((anchor) => [anchor.entryId, anchor]))
  let latestIndex = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (anchorByEntry.has(entries[i].id)) {
      latestIndex = i
      break
    }
  }
  if (latestIndex === -1) return empty

  const boundaryEntry = entries[latestIndex]
  const anchor = anchorByEntry.get(boundaryEntry.id)!
  const recorded = ending(boundaryEntry)
  const tail = entries.slice(latestIndex + 1)

  return {
    entryId: boundaryEntry.id,
    assertedTime: anchor.assertedTime,
    recordedTime: recorded,
    agrees: recorded ? toMinutes(recorded) === toMinutes(anchor.assertedTime) : null,
    entriesAfter: tail.length,
    elapsedAfter: tailElapsed(anchor.assertedTime, tail),
  }
}

/** Null rather than a negative or invented duration: an unusable tail is reported as unusable. */
function tailElapsed(from: TimeTracker, tail: StoryEntry[]): TimeTracker | null {
  if (tail.length === 0) return fromMinutes(0)

  const lastEnd = ending(tail[tail.length - 1])
  if (!lastEnd) return null
  if (tail.some((entry) => !ending(entry))) return null

  let previous = toMinutes(from)
  for (const entry of tail) {
    const end = toMinutes(ending(entry)!)
    if (end < previous) return null
    previous = end
  }

  return fromMinutes(toMinutes(lastEnd) - toMinutes(from))
}
