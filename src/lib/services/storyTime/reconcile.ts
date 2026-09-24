/**
 * Fitting a selected range between its two boundaries.
 *
 * Pure: entries and boundaries in, new times out. Persistence, chapter spans and the clock
 * are the caller's job, which is what lets the preview and the apply path share one
 * calculation — the preview *is* this output, and applying writes exactly it.
 *
 * The range is weighed as an alternating sequence of entry durations and the intervals
 * between them. What an interval means is not in the record — a deliberate skip, an entry that
 * ran longer than it says, or a nudged clock — so the reader may state its weight, and one left
 * unstated keeps its recorded length.
 */

import type { StoryEntry, TimeTracker } from '$lib/types'
import { toMinutes, fromMinutes } from './minutes'

export interface ReconciledTime {
  entryId: string
  start: TimeTracker
  end: TimeTracker
}

/** An entry whose own duration cannot be read, and is therefore asked for. */
export interface DurationRequest {
  entryId: string
  reason: 'missing-times' | 'backwards' | 'invalid-override'
  /** Set when a value was supplied but is not a finite, non-negative whole number of minutes. */
  invalid?: boolean
}

export interface Join {
  /** The unchanged time on the far side of the join. */
  neighbourTime: TimeTracker | null
  /** The range's edge afterwards. */
  edgeTime: TimeTracker
  /** Positive when the neighbour runs past the edge, negative when a gap is left. */
  differenceMinutes: number
}

export interface ReconcileInput {
  /** Entries inside the range, in story order. */
  entries: StoryEntry[]
  /** The earlier boundary's resolved time. The range begins here. */
  baseline: TimeTracker
  /** The later boundary's resolved time. */
  target: TimeTracker
  /** Stored ending of the entry before the range, for reporting the leading join. */
  previousEnd?: TimeTracker | null
  /** Stored beginning of the entry after the range, for reporting the trailing join. */
  nextStart?: TimeTracker | null
  /** Reader-supplied entry durations in whole minutes, by entry id. */
  suppliedDurations?: Record<string, number>
  /**
   * Interval lengths the reader states, in minutes, keyed by the entry each follows.
   *
   * A stated length replaces the recorded one, and stands in for it where the record holds
   * none: an interval the record does not have is still a fact about the story, and a reader
   * who knows a night passed has no other way to say so.
   */
  intervalWeights?: Record<string, number>
}

export type ReconcileResult =
  | { status: 'needs-durations'; requests: DurationRequest[] }
  | { status: 'refused'; reason: 'backwards-span' }
  | {
      status: 'ok'
      times: ReconciledTime[]
      leadingJoin: Join
      trailingJoin: Join | null
    }

function isValidSupplied(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  )
}

/**
 * An entry's own recorded length, or a request standing in for it.
 *
 * Measured inside the entry rather than against its neighbour or the baseline. Against the
 * baseline, an assertion far from the record — which is the whole reason to anchor — turns
 * every first weight negative. Against the neighbour, a reconciliation mixes rewritten times with
 * unrewritten ones and a second run gives a different answer.
 *
 * A missing time therefore costs one weight rather than two: nothing is measured *through* an
 * entry, so a gap in the record does not spread to its successor.
 */
function weighEntries(
  entries: StoryEntry[],
  supplied: Record<string, number>,
): { durations: number[]; requests: DurationRequest[] } {
  const durations: number[] = []
  const requests: DurationRequest[] = []

  for (const entry of entries) {
    // A user action is an instant by construction: the clock advances during classification,
    // which writes back to the narration entry. Whatever the record says about one — nothing,
    // a span, a negative — it weighs zero, and asking the reader how long their own action
    // lasted would be asking about nothing that happened.
    if (entry.type === 'user_action') {
      durations.push(0)
      continue
    }

    // A supplied value overrides a readable record, not merely a broken one: the reader may
    // say what any entry is worth. It sets the entry's *weight*, so the length it ends up
    // with is that weight's share of the span rather than the figure itself.
    const value = supplied[entry.id]
    if (value !== undefined) {
      if (isValidSupplied(value)) {
        durations.push(value)
      } else {
        durations.push(0)
        requests.push({ entryId: entry.id, reason: 'invalid-override', invalid: true })
      }
      continue
    }

    const start = entry.metadata?.timeStart
    const end = entry.metadata?.timeEnd
    const recorded = start && end ? toMinutes(end) - toMinutes(start) : null

    if (recorded !== null && recorded >= 0) {
      durations.push(recorded)
      continue
    }

    durations.push(0)
    requests.push({
      entryId: entry.id,
      reason: recorded === null ? 'missing-times' : 'backwards',
    })
  }

  return { durations, requests }
}

/** Interval lengths, one per adjacent pair, the reader's own standing in where given. */
function gapsOf(entries: StoryEntry[], stated: Record<string, number>): number[] {
  return recordedGaps(entries).map((minutes, i) => stated[entries[i].id] ?? minutes)
}

/**
 * The interval each pair of neighbouring entries has between them, as the record holds it.
 *
 * Where the record overlaps instead — an entry beginning before the one before it ended — the
 * interval reads as zero. That is two records disagreeing rather than time passing, and
 * detection reports it.
 */
function recordedGaps(entries: StoryEntry[]): number[] {
  const gaps: number[] = []
  for (let i = 0; i < entries.length - 1; i++) {
    const end = entries[i].metadata?.timeEnd
    const nextStart = entries[i + 1].metadata?.timeStart
    if (!end || !nextStart) {
      gaps.push(0)
      continue
    }
    gaps.push(Math.max(0, toMinutes(nextStart) - toMinutes(end)))
  }
  return gaps
}

/**
 * What the range cannot weigh yet, without attempting to reconcile it.
 *
 * The review needs this to mark rows while the Becomes column is still blank: nothing is
 * reconciled until every entry has a length and every interval a decision.
 */
export function outstandingDurations(
  entries: StoryEntry[],
  supplied: Record<string, number> = {},
): DurationRequest[] {
  return weighEntries(entries, supplied).requests
}

export interface RangeInterval {
  afterEntryId: string
  beforeEntryId: string
  recordedMinutes: number
}

/** The intervals inside a range, the reader's own included. */
export function rangeIntervals(
  entries: StoryEntry[],
  intervalWeights: Record<string, number> = {},
): RangeInterval[] {
  return gapsOf(entries, intervalWeights).map((recordedMinutes, i) => ({
    afterEntryId: entries[i].id,
    beforeEntryId: entries[i + 1].id,
    recordedMinutes,
  }))
}

/**
 * Fit the range to its boundaries.
 *
 * Reconciling again with unchanged boundaries changes nothing: afterwards every duration and
 * every interval is exactly the share it was given, and those sum to the span, so the next run
 * scales by one.
 */
export function reconcileRange(input: ReconcileInput): ReconcileResult {
  const { entries, baseline, target, previousEnd = null, nextStart = null } = input
  const supplied = input.suppliedDurations ?? {}

  const baselineMinutes = toMinutes(baseline)
  const targetMinutes = toMinutes(target)
  if (targetMinutes < baselineMinutes) return { status: 'refused', reason: 'backwards-span' }

  const { durations, requests } = weighEntries(entries, supplied)
  // Every request is resolved before a scaling rule is chosen: a supplied duration can turn an
  // apparently empty range into a paced one.
  if (requests.length > 0) return { status: 'needs-durations', requests }

  const gapWeights = gapsOf(entries, input.intervalWeights ?? {})
  const span = targetMinutes - baselineMinutes

  // Durations and the intervals between them, alternating: [d0, g0, d1, g1, … dN-1].
  const weights: number[] = []
  durations.forEach((duration, i) => {
    weights.push(duration)
    if (i < gapWeights.length) weights.push(gapWeights[i])
  })

  const cumulative: number[] = []
  let running = 0
  for (const weight of weights) {
    running += weight
    cumulative.push(running)
  }
  const total = running

  // Offsets from the baseline, taken against the running total so rounding cannot accumulate
  // and the range lands exactly on the later boundary.
  const offsetAfter = (index: number) => Math.round((span * cumulative[index]) / total)

  const times: ReconciledTime[] = []
  // Nothing to preserve anywhere, so the span is shared evenly — by the entries that can hold
  // time. A player action stays an instant whatever the arithmetic says: it sits where the walk
  // has reached, and giving it a share would make the reader's own turn take an hour of story.
  let sharesTaken = 0
  const shareHolders = entries.filter((entry) => entry.type !== 'user_action').length

  entries.forEach((entry, i) => {
    if (total === 0) {
      const at = shareHolders === 0 ? 0 : Math.round((span * sharesTaken) / shareHolders)
      if (entry.type === 'user_action') {
        const instant = fromMinutes(baselineMinutes + at)
        times.push({ entryId: entry.id, start: instant, end: instant })
        return
      }
      sharesTaken += 1
      const end = shareHolders === 0 ? 0 : Math.round((span * sharesTaken) / shareHolders)
      times.push({
        entryId: entry.id,
        start: fromMinutes(baselineMinutes + at),
        end: fromMinutes(baselineMinutes + end),
      })
      return
    }

    const start = i === 0 ? 0 : offsetAfter(2 * i - 1)
    const end = offsetAfter(2 * i)
    times.push({
      entryId: entry.id,
      start: fromMinutes(baselineMinutes + start),
      end: fromMinutes(baselineMinutes + end),
    })
  })

  const finalEnd = times.length > 0 ? times[times.length - 1].end : target

  return {
    status: 'ok',
    times,
    leadingJoin: {
      neighbourTime: previousEnd,
      edgeTime: baseline,
      differenceMinutes: previousEnd ? toMinutes(previousEnd) - baselineMinutes : 0,
    },
    trailingJoin: nextStart
      ? {
          neighbourTime: nextStart,
          edgeTime: finalEnd,
          differenceMinutes: toMinutes(nextStart) - toMinutes(finalEnd),
        }
      : null,
  }
}
