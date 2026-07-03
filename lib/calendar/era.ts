import type { CalendarSystem, TierTuple } from './calendar-schema'
import { worldTimeToTuple } from './world-time-to-tuple'

export type EraFlip = { at_worldtime: number; era_name: string }
export type EraResult = { era: string; eraYear: number }

export function resolveEra(
  worldTime: number,
  calendar: CalendarSystem,
  origin: TierTuple,
  flips: EraFlip[],
): EraResult {
  const era = calendar.eras
  if (era == null) return { era: '', eraYear: 0 }
  const active = flips
    .filter((f) => f.at_worldtime <= worldTime)
    .sort((a, b) => b.at_worldtime - a.at_worldtime)[0]
  const eraName = active?.era_name ?? era.defaultStartName
  const eraStartWorldTime = active?.at_worldtime ?? 0
  const currentYear = worldTimeToTuple(worldTime, calendar, origin).year
  const eraStartYear = worldTimeToTuple(eraStartWorldTime, calendar, origin).year
  return { era: eraName, eraYear: currentYear - eraStartYear + 1 }
}
