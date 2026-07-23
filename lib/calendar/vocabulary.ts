import type { CalendarSystem } from './calendar-schema'

export type CalendarVocabulary = {
  baseUnitName: string
  secondsPerBaseUnit: number
  tiers: { name: string; labels: string[] }[]
  eraDefaultName: string | null
  eraPresetNames: string[]
}

export function describeCalendarVocabulary(calendar: CalendarSystem): CalendarVocabulary {
  return {
    baseUnitName: calendar.baseUnitName,
    secondsPerBaseUnit: calendar.secondsPerBaseUnit,
    tiers: calendar.tiers.map((t) => ({ name: t.name, labels: t.labels ?? [] })),
    eraDefaultName: calendar.eras?.defaultStartName ?? null,
    eraPresetNames: calendar.eras?.presetNames ?? [],
  }
}
