import { tierMax, type CalendarSystem, type TierTuple } from '@/lib/calendar'

export type OriginValidity = { ok: true } | { ok: false; tier: string; min: number; max: number }

// Walks tiers top-down and stops at the first invalid one. This isn't just
// fail-fast: a lower tier's own range is only meaningful once every coarser
// tier is confirmed valid (day-in-month depends on month + leap-year), so
// there is no well-defined "second error" to report until the first is fixed.
export function validateOriginTuple(tuple: TierTuple, calendar: CalendarSystem): OriginValidity {
  for (const tier of calendar.tiers) {
    const value = tuple[tier.name]
    const min = tier.startValue
    const max = tierMax(calendar, tier.name, tuple)
    if (value === undefined || !Number.isInteger(value) || value < min || value > max) {
      return { ok: false, tier: tier.name, min, max }
    }
  }
  return { ok: true }
}
