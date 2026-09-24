import type { CalendarSystem } from './calendar-schema'

export type WholeTierSpan = { tier: string; count: number }

/**
 * `elapsedSeconds` counted in the largest tier whose length never varies (Gregorian `day`, not
 * `month`), floored. Zero of the smallest tier below one of it; null for a negative span.
 */
export function largestWholeTier(
  calendar: CalendarSystem,
  elapsedSeconds: number,
): WholeTierSpan | null {
  if (!(elapsedSeconds >= 0)) return null
  const baseUnits = Math.floor(elapsedSeconds / calendar.secondsPerBaseUnit)
  const { tiers } = calendar
  let best: WholeTierSpan = { tier: tiers[tiers.length - 1].name, count: 0 }
  // Tier length = product of the rollovers below; past a variable one (days-in-month) it varies.
  let length = 1
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (baseUnits >= length) best = { tier: tiers[i].name, count: Math.floor(baseUnits / length) }
    const rollover = tiers[i].rollover
    if (rollover.kind !== 'constant') break
    length *= rollover.value
  }
  return best
}
