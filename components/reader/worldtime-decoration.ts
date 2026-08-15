import { FormatMiss, formatWorldTime, type CalendarSystem, type TierTuple } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

export type WorldTimeDecoration = {
  /** Pre-formatted by the active calendar. */
  label: string
  /** Raw cumulative seconds; presence marks the footer editable. */
  raw: number
  /** Set when this entry's world time goes backwards; names the predecessor. */
  previousLabel?: string
}

const EDITABLE_KINDS = new Set<StoryEntry['kind']>(['user_action', 'ai_reply', 'opening'])

/**
 * Window-local walk keyed by entry id, so an unrelated row's unchanged
 * primitives stay referentially stable at the ReaderRow seam — undecorated
 * entries simply have no key. `entries` MUST already be in ascending
 * narrative (position) order: the walk only ever compares against the most
 * recently decorated predecessor, so an out-of-order input produces wrong
 * flags silently rather than an error. The first decorated entry has no
 * ancestor and is never flagged. worldTime === 0 marks a flashback — never
 * flagged, never the ancestor a later entry compares against
 * (docs/ui/patterns/entry-card.md → World-time footer).
 */
export function decorateWorldTime(
  entries: StoryEntry[],
  calendar: CalendarSystem,
  origin: TierTuple,
): Record<string, WorldTimeDecoration> {
  const decorations: Record<string, WorldTimeDecoration> = {}
  // Call-local only (no cross-call state, function stays pure): consecutive
  // rows often repeat a worldTime verbatim (lib/actions/turns/submit-turn.ts
  // inherits the predecessor's), so caching the Liquid render by value skips
  // re-parsing displayFormat for roughly every other row.
  const labelCache = new Map<number, string | FormatMiss>()
  let prev: { worldTime: number; label: string } | null = null

  for (const row of entries) {
    if (!EDITABLE_KINDS.has(row.kind)) continue
    const worldTime = row.metadata?.worldTime
    if (worldTime == null) continue

    let label = labelCache.get(worldTime)
    if (label === undefined) {
      label = formatWorldTime(worldTime, calendar, origin)
      labelCache.set(worldTime, label)
    }
    if (label instanceof FormatMiss || label === '') continue

    const decoration: WorldTimeDecoration = { label, raw: worldTime }
    if (prev != null && worldTime > 0 && worldTime < prev.worldTime) {
      decoration.previousLabel = prev.label
    }
    decorations[row.id] = decoration
    if (worldTime > 0) prev = { worldTime, label }
  }

  return decorations
}
