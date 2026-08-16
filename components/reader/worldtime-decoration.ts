import type { CalendarFrame } from '@/lib/calendar'
import { FormatMiss, formatWorldTime } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

export type WorldTimeDecoration = {
  /** Pre-formatted by the active calendar. */
  label: string
  /** Raw cumulative seconds. */
  raw: number
  /** Set when this entry's world time goes backwards; names the predecessor. */
  previousLabel?: string
}

const EDITABLE_KINDS = new Set<StoryEntry['kind']>(['user_action', 'ai_reply', 'opening'])

/**
 * Keyed by entry id rather than merged into the rows, so an unrelated row's
 * primitives stay value-stable at the ReaderRow seam — undecorated entries
 * simply have no key. The walk is window-local, so a monotonicity break across
 * the window boundary is invisible. `entries` MUST already be in ascending
 * narrative (position) order: the walk only ever compares against the most
 * recently decorated predecessor, so an out-of-order input produces wrong
 * flags silently rather than an error. The first decorated entry has no
 * ancestor and is never flagged. worldTime === 0 marks a flashback — never
 * flagged, never the ancestor a later entry compares against
 * (docs/ui/patterns/entry-card.md → World-time footer).
 */
export function decorateWorldTime(
  entries: StoryEntry[],
  frame: CalendarFrame,
): Record<string, WorldTimeDecoration> {
  const { calendar, origin } = frame
  const decorations: Record<string, WorldTimeDecoration> = {}
  // Call-local only (no cross-call state, function stays pure): a turn's
  // ai_reply and the next turn's user_action repeat a worldTime verbatim
  // (lib/pipeline/definitions/per-turn.ts, then submit-turn.ts inherits it), so
  // caching by value skips re-parsing displayFormat for roughly every other row.
  const labelCache = new Map<number, string | FormatMiss>()
  let prev: { worldTime: number; label: string } | null = null
  let missed = 0
  let missReason: string | undefined

  for (const row of entries) {
    if (!EDITABLE_KINDS.has(row.kind)) continue
    const worldTime = row.metadata?.worldTime
    if (worldTime == null) continue

    let label = labelCache.get(worldTime)
    if (label === undefined) {
      label = formatWorldTime(worldTime, calendar, origin)
      labelCache.set(worldTime, label)
    }
    if (label instanceof FormatMiss || label === '') {
      missed += 1
      missReason ??= label instanceof FormatMiss ? label.reason : 'displayFormat rendered empty'
      continue
    }

    const decoration: WorldTimeDecoration = { label, raw: worldTime }
    if (prev != null && worldTime > 0 && worldTime < prev.worldTime) {
      decoration.previousLabel = prev.label
    }
    decorations[row.id] = decoration
    if (worldTime > 0) prev = { worldTime, label }
  }

  // A broken displayFormat fails for every row at once, taking the label, the
  // indicator and the edit affordance with it — on screen that is
  // indistinguishable from a story that tracks no world time. One line per
  // walk, not per row, since the reason is identical across them.
  if (missed > 0) {
    logger.warn('calendar.format_miss', {
      calendarId: calendar.id,
      entries: missed,
      reason: missReason,
    })
  }

  return decorations
}
