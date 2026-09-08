/**
 * Fitting a selected range between its two boundaries.
 *
 * Pure: entries and boundaries in, new times out. Persistence, chapter repair and the clock
 * are the caller's job, which is what lets the preview and the apply path share one
 * calculation — the preview *is* this output, and applying writes exactly it.
 *
 * The range is weighed as an alternating sequence of entry durations and the intervals
 * between them. What an interval means is not in the record — a deliberate skip, an entry that
 * ran longer than it says, or a nudged clock — so each carries a policy the reader chooses, and
 * only the default preserves it as recorded.
 */

import type { StoryEntry, TimeTracker } from '$lib/types'
import { toMinutes, fromMinutes } from './minutes'

export interface RepairedTime {
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

/**
 * What the reader has decided about one interval.
 *
 * `keep` weighs it where it is, `void` gives it no share while everything else keeps theirs,
 * and the two `fuse` forms hand its time to the entry on one side.
 */
export type GapPolicy = 'keep' | 'void' | 'fuse-previous' | 'fuse-next'

export interface RangeGap {
  /** The entry the interval follows. */
  afterEntryId: string
  beforeEntryId: string
  recordedMinutes: number
  /** The policy actually applied, which falls back to `keep` when a fuse has no target. */
  policy: GapPolicy
  /** What it contributes to the weighting once the policy is applied. */
  weightedMinutes: number
  /** The entry a backward fuse would land on, or null when there is none in the range. */
  fusePreviousEntryId: string | null
  fuseNextEntryId: string | null
}

export interface Join {
  /** The unchanged time on the far side of the join. */
  neighbourTime: TimeTracker | null
  /** The range's edge after the repair. */
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
  /** What to do with the interval after each entry, keyed by that entry's id. Defaults to `keep`. */
  gapPolicies?: Record<string, GapPolicy>
}

export type ReconcileResult =
  | { status: 'needs-durations'; requests: DurationRequest[] }
  | { status: 'refused'; reason: 'backwards-span' }
  | {
      status: 'ok'
      times: RepairedTime[]
      gaps: RangeGap[]
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
 * every first weight negative. Against the neighbour, a repair mixes rewritten times with
 * unrewritten ones and a second run gives a different answer.
 *
 * It also means a missing time costs one weight rather than two: nothing is measured *through*
 * an entry any more, so a gap in the record no longer spreads to its successor.
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
 * Apply the reader's decision about each interval.
 *
 * An interval is time the story did not narrate, and what it means is not in the record: a
 * deliberate skip, an entry that really ran longer than it says, or a clock that was nudged.
 * Only the reader knows which, so each one carries a policy and the default merely preserves
 * what is recorded.
 */
/**
 * The nearest entry in one direction that can hold scene time.
 *
 * A user action records no duration by construction — the clock advances during
 * classification, which writes back to the narration entry — so fusing an interval into one
 * would give an instant a length. The search steps over them to the narration either side.
 */
function fuseTarget(entries: StoryEntry[], from: number, step: -1 | 1): number | null {
  for (let i = from; i >= 0 && i < entries.length; i += step) {
    if (entries[i].type !== 'user_action') return i
  }
  return null
}

function applyGapPolicies(
  entries: StoryEntry[],
  durations: number[],
  gaps: number[],
  policies: Record<string, GapPolicy>,
): { durations: number[]; gapWeights: number[]; decisions: RangeGap[] } {
  const adjusted = [...durations]
  const gapWeights: number[] = []
  const decisions: RangeGap[] = []

  gaps.forEach((recorded, i) => {
    const afterEntryId = entries[i].id
    const previousTarget = fuseTarget(entries, i, -1)
    const nextTarget = fuseTarget(entries, i + 1, 1)
    const requested = policies[afterEntryId] ?? 'keep'

    // A fuse with nowhere to land keeps the interval instead of silently discarding it.
    const policy: GapPolicy =
      (requested === 'fuse-previous' && previousTarget === null) ||
      (requested === 'fuse-next' && nextTarget === null)
        ? 'keep'
        : requested

    if (policy === 'fuse-previous') adjusted[previousTarget!] += recorded
    if (policy === 'fuse-next') adjusted[nextTarget!] += recorded
    const weighted = policy === 'keep' ? recorded : 0
    gapWeights.push(weighted)

    decisions.push({
      afterEntryId,
      beforeEntryId: entries[i + 1].id,
      recordedMinutes: recorded,
      policy,
      weightedMinutes: weighted,
      fusePreviousEntryId: previousTarget === null ? null : entries[previousTarget].id,
      fuseNextEntryId: nextTarget === null ? null : entries[nextTarget].id,
    })
  })

  return { durations: adjusted, gapWeights, decisions }
}

/**
 * What the range cannot weigh yet, without attempting a repair.
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
  fusePreviousEntryId: string | null
  fuseNextEntryId: string | null
}

/** The intervals the record holds inside a range, with what a fuse in each direction would hit. */
export function rangeIntervals(entries: StoryEntry[]): RangeInterval[] {
  return recordedGaps(entries).map((recordedMinutes, i) => {
    const previousTarget = fuseTarget(entries, i, -1)
    const nextTarget = fuseTarget(entries, i + 1, 1)
    return {
      afterEntryId: entries[i].id,
      beforeEntryId: entries[i + 1].id,
      recordedMinutes,
      fusePreviousEntryId: previousTarget === null ? null : entries[previousTarget].id,
      fuseNextEntryId: nextTarget === null ? null : entries[nextTarget].id,
    }
  })
}

/**
 * Fit the range to its boundaries.
 *
 * Repeating a repair with unchanged boundaries changes nothing: afterwards every duration and
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

  const {
    durations: weighted,
    gapWeights,
    decisions,
  } = applyGapPolicies(entries, durations, recordedGaps(entries), input.gapPolicies ?? {})
  const span = targetMinutes - baselineMinutes

  // Durations and the intervals between them, alternating: [d0, g0, d1, g1, … dN-1].
  const weights: number[] = []
  weighted.forEach((duration, i) => {
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

  const times: RepairedTime[] = []
  entries.forEach((entry, i) => {
    if (total === 0) {
      // Nothing to preserve anywhere, so the span is divided evenly across the entries and the
      // intervals stay closed.
      const start = Math.round((span * i) / entries.length)
      const end = Math.round((span * (i + 1)) / entries.length)
      times.push({
        entryId: entry.id,
        start: fromMinutes(baselineMinutes + start),
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
    gaps: decisions,
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
