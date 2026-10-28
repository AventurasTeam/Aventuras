import type { Happening } from '@/lib/db'

/**
 * classifier.md → What the classifier reads → Known happenings. A happening with no narrative
 * position joins through a record or a create anchored to a recent entry; a recorded id with no
 * row is left out.
 */
export function knownHappenings<H extends Pick<Happening, 'id' | 'occurredAtEntryId'>>(
  happenings: readonly H[],
  sources: {
    recorded: ReadonlySet<string>
    recentEntryIds: ReadonlySet<string>
    madeFromRecent: ReadonlySet<string>
  },
): H[] {
  return happenings.filter(
    (h) =>
      sources.recorded.has(h.id) ||
      sources.madeFromRecent.has(h.id) ||
      (h.occurredAtEntryId != null && sources.recentEntryIds.has(h.occurredAtEntryId)),
  )
}
