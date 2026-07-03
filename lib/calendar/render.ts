import { Liquid } from 'liquidjs'

import type { CalendarSystem, TierTuple } from './calendar-schema'
import { resolveEra, type EraFlip } from './era'
import { worldTimeToTuple } from './world-time-to-tuple'

export class FormatMiss {
  constructor(public readonly reason: string) {}
}

const engine = new Liquid()

function monthName(calendar: CalendarSystem, tuple: TierTuple): string | undefined {
  const monthTier = calendar.tiers.find((t) => t.name === 'month')
  if (!monthTier?.labels) return undefined
  return monthTier.labels[tuple.month - monthTier.startValue]
}

export function formatWorldTime(
  worldTime: number,
  calendar: CalendarSystem,
  origin: TierTuple,
  flips: EraFlip[] = [],
): string | FormatMiss {
  try {
    // At worldTime 0 the tuple IS the origin: worldTimeToTuple round-trips
    // origin through tupleToBaseUnits/baseUnitsToTuple, which only holds for
    // non-negative tier values (the story-start BC origin would otherwise
    // come back normalized to year >= 1).
    const tuple = worldTime === 0 ? origin : worldTimeToTuple(worldTime, calendar, origin)
    const era = calendar.eras
      ? resolveEra(worldTime, calendar, origin, flips)
      : { era: '', eraYear: 0 }
    const scope = {
      ...tuple,
      monthName: monthName(calendar, tuple),
      era: era.era,
      eraYear: era.eraYear,
    }
    return engine.parseAndRenderSync(calendar.displayFormat, scope) as string
  } catch (err) {
    return new FormatMiss(err instanceof Error ? err.message : String(err))
  }
}
