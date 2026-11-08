import type { CloseRangeEntry } from '../chapter-context'

/** A run of the chapter's entries the prose tasks read at once; `index` from 1 (C4). */
export type ClosePart = { index: number; entryIds: readonly string[] }

/** The whole chapter as part 1, until the window cuts parts (5.8). */
export function closeParts(entries: readonly CloseRangeEntry[]): readonly ClosePart[] {
  return [{ index: 1, entryIds: entries.map((entry) => entry.id) }]
}
