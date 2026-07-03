import {
  FormatMiss,
  formatWorldTime,
  type CalendarSystem,
  type Tier,
  type TierTuple,
} from '@/lib/calendar'

import { validateOriginTuple } from './tier-tuple-input-logic'

export type SwapResult = { origin: TierTuple; reset: boolean }

// Preserve overlapping tier values across a calendar swap; fill any tier the
// target adds from its exampleStartValue; full reset (+ caller-shown notice)
// when NO tiers overlap at all (disjoint tier sets, e.g. Earth → Stardate).
// Takes the resolved target CalendarSystem (not an id) so it's testable with
// throwaway fixtures, without touching the calendar registry.
export function preserveOriginOnSwap(prev: TierTuple, target: CalendarSystem): SwapResult {
  const example = target.exampleStartValue
  const next: TierTuple = {}
  let anyOverlap = false
  for (const tier of target.tiers) {
    if (tier.name in prev) {
      next[tier.name] = prev[tier.name]
      anyOverlap = true
    } else {
      next[tier.name] = example[tier.name]
    }
  }
  return anyOverlap ? { origin: next, reset: false } : { origin: { ...example }, reset: true }
}

export type TierDetail =
  | { kind: 'constant'; unitTierName: string; value: number }
  | { kind: 'table'; unitTierName: string; min: number; max: number }
  | { kind: 'rule'; unitTierName: string; against: string }
  | { kind: 'base-unit' }

export type SubdivisionsSummary =
  | { kind: 'none' }
  | {
      kind: 'weekday'
      subdivisionName: string
      hostTierName: string
      first: string
      last: string
      length: number
    }

export type ErasSummary =
  | { kind: 'disabled' }
  | { kind: 'freeform' }
  | { kind: 'preset'; names: string[] }

export type CalendarStepSummary = {
  tiers: { name: string; detail: TierDetail }[]
  subdivisions: SubdivisionsSummary
  eras: ErasSummary
}

// A tier's rollover describes how many of ITSELF fit in one unit of its own
// parent (see world-time-to-tuple.ts). Displaying that at the PARENT's row
// ("month · table: 28–31 days") reads naturally as "this is how a month
// subdivides"; the leaf tier (nothing below it) is the base unit.
function tierDetailFor(child: Tier | undefined): TierDetail {
  if (!child) return { kind: 'base-unit' }
  const r = child.rollover
  if (r.kind === 'constant') return { kind: 'constant', unitTierName: child.name, value: r.value }
  if (r.kind === 'table') {
    return {
      kind: 'table',
      unitTierName: child.name,
      min: Math.min(...r.values),
      max: Math.max(...r.values),
    }
  }
  return { kind: 'rule', unitTierName: child.name, against: r.against }
}

export function buildCalendarSummary(calendar: CalendarSystem): CalendarStepSummary {
  const tiers = calendar.tiers.map((tier, i) => ({
    name: tier.name,
    detail: tierDetailFor(calendar.tiers[i + 1]),
  }))

  const subdivisionHost = calendar.tiers.find((t) => (t.subdivisions?.length ?? 0) > 0)
  const sub = subdivisionHost?.subdivisions?.[0]
  const subdivisions: SubdivisionsSummary = sub
    ? {
        kind: 'weekday',
        subdivisionName: sub.name,
        hostTierName: subdivisionHost!.name,
        first: sub.labels[0],
        last: sub.labels[sub.labels.length - 1],
        length: sub.length,
      }
    : { kind: 'none' }

  const eras: ErasSummary =
    calendar.eras === null
      ? { kind: 'disabled' }
      : (calendar.eras.presetNames?.length ?? 0) > 0
        ? { kind: 'preset', names: calendar.eras.presetNames! }
        : { kind: 'freeform' }

  return { tiers, subdivisions, eras }
}

// Returns the sample render for worldTime 0 once the origin fully validates
// against the calendar's rollover rules; null tells the caller to show the
// pre-origin placeholder instead (empty origin, out-of-range tier, or a
// display-format render failure).
export function computeSampleRender(calendar: CalendarSystem, origin: TierTuple): string | null {
  if (!validateOriginTuple(origin, calendar).ok) return null
  const rendered = formatWorldTime(0, calendar, origin)
  return rendered instanceof FormatMiss ? null : rendered
}

export function buildTierPath(calendar: CalendarSystem): string {
  return calendar.tiers.map((t) => t.name).join(' → ')
}
