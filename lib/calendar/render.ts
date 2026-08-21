import { Liquid } from 'liquidjs'

import { logger } from '@/lib/diagnostics'

import type { CalendarSystem, TierTuple } from './calendar-schema'
import { resolveEra, type EraFlip } from './era'
import { MAX_WORLD_TIME_SECONDS } from './limits'
import { worldTimeToTuple } from './world-time-to-tuple'

export class FormatMiss {
  constructor(public readonly reason: string) {}
}

const engine = new Liquid()

// Liquid ships no zero-pad filter, and clock-style tiers are unreadable without
// one (`0:5` for five past midnight). Calendar-authored templates use it too.
engine.registerFilter('pad', (value: unknown, width: unknown) => {
  const parsed = width === undefined ? 2 : Number(width)
  if (!Number.isInteger(parsed) || parsed < 1) {
    // Only reachable from an authored displayFormat, where the template author
    // gets no other feedback that the argument was ignored.
    logger.warn('calendar.pad_width_invalid', { width })
    return String(value).padStart(2, '0')
  }
  return String(value).padStart(parsed, '0')
})

// Unbounded is safe: one displayFormat per calendar, immutable per story
// config. A parse failure throws before the set, so it is retried, never cached.
const parsedTemplates = new Map<string, ReturnType<Liquid['parse']>>()

function parsedTemplate(displayFormat: string): ReturnType<Liquid['parse']> {
  let tpl = parsedTemplates.get(displayFormat)
  if (!tpl) {
    tpl = engine.parse(displayFormat)
    parsedTemplates.set(displayFormat, tpl)
  }
  return tpl
}

function monthName(calendar: CalendarSystem, tuple: TierTuple): string | undefined {
  const monthTier = calendar.tiers.find((t) => t.name === 'month')
  if (!monthTier?.labels) return undefined
  return monthTier.labels[tuple.month - monthTier.startValue]
}

// An origin may omit tiers, and a missing tier contributes nothing to
// tupleToBaseUnits' sum (its accumulation loop never runs). The template must
// see the same completed tuple that baseUnitsToTuple hands the non-zero path.
function completeTuple(calendar: CalendarSystem, tuple: TierTuple): TierTuple {
  const out: TierTuple = {}
  for (const tier of calendar.tiers) out[tier.name] = tuple[tier.name] ?? tier.startValue
  return out
}

export function formatWorldTime(
  worldTime: number,
  calendar: CalendarSystem,
  origin: TierTuple,
  flips: EraFlip[] = [],
): string | FormatMiss {
  // The write paths bound this, but a row stored before they did would walk the
  // top tier for minutes on the UI thread. Missing here costs a footer; not
  // missing costs the first paint.
  if (!Number.isFinite(worldTime) || worldTime < 0 || worldTime > MAX_WORLD_TIME_SECONDS) {
    return new FormatMiss(`worldTime outside the renderable range: ${worldTime}`)
  }
  try {
    // Completed once and used for both: an era resolved against the raw partial
    // would disagree with the tuple the template renders.
    const completedOrigin = completeTuple(calendar, origin)
    // At worldTime 0 the tuple IS the origin; worldTimeToTuple's round-trip breaks for BC origins.
    const tuple =
      worldTime === 0 ? completedOrigin : worldTimeToTuple(worldTime, calendar, completedOrigin)
    const era = calendar.eras
      ? resolveEra(worldTime, calendar, completedOrigin, flips)
      : { era: '', eraYear: 0 }
    const scope = {
      ...tuple,
      monthName: monthName(calendar, tuple),
      era: era.era,
      eraYear: era.eraYear,
    }
    return engine.renderSync(parsedTemplate(calendar.displayFormat), scope) as string
  } catch (err) {
    return new FormatMiss(err instanceof Error ? err.message : String(err))
  }
}
