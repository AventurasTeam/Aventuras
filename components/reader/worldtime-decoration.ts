import { FormatMiss, formatWorldTime, type CalendarSystem, type TierTuple } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

export type DecoratedEntry = StoryEntry & {
  /** Pre-formatted by the active calendar; absent → footer hidden. */
  worldTimeLabel?: string
  /** Raw cumulative seconds; presence marks the footer editable. */
  worldTimeRaw?: number
  worldTimeMonotonicityBreak?: { previousLabel: string }
}

const EDITABLE_KINDS = new Set<StoryEntry['kind']>(['user_action', 'ai_reply', 'opening'])

/**
 * Window-local walk: only sees the loaded window, so the first decorated
 * entry never has an ancestor to compare against and is never flagged.
 * worldTime === 0 marks a flashback — never flagged, never the ancestor a
 * later entry compares against (docs/ui/patterns/entry-card.md → World-time footer).
 */
export function decorateWorldTime(
  entries: StoryEntry[],
  calendar: CalendarSystem,
  origin: TierTuple,
): DecoratedEntry[] {
  let prev: { worldTime: number; label: string } | null = null
  return entries.map((row) => {
    if (!EDITABLE_KINDS.has(row.kind)) return row
    const worldTime = row.metadata?.worldTime
    if (worldTime == null) return row
    const label = formatWorldTime(worldTime, calendar, origin)
    if (label instanceof FormatMiss) return row
    const decorated: DecoratedEntry = { ...row, worldTimeLabel: label, worldTimeRaw: worldTime }
    if (prev != null && worldTime > 0 && worldTime < prev.worldTime) {
      decorated.worldTimeMonotonicityBreak = { previousLabel: prev.label }
    }
    if (worldTime > 0) prev = { worldTime, label }
    return decorated
  })
}
