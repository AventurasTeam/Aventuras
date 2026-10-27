import type { Happening } from '@/lib/db'

/**
 * classifier.md → What the classifier reads → Known happenings: the happenings the window's turns
 * were given, and those that occurred in the recent entries. A happening with no narrative
 * position joins only through a record; a recorded id with no row is left out. Store order is
 * kept, as placeholders number in walk order.
 */
export function knownHappenings<H extends Pick<Happening, 'id' | 'occurredAtEntryId'>>(
  happenings: readonly H[],
  sources: { recorded: ReadonlySet<string>; recentEntryIds: ReadonlySet<string> },
): H[] {
  return happenings.filter(
    (h) =>
      sources.recorded.has(h.id) ||
      (h.occurredAtEntryId != null && sources.recentEntryIds.has(h.occurredAtEntryId)),
  )
}
