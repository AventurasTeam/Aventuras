import type { ChapterPartCut } from '@/lib/chapters'

import type { CloseRangeEntry } from '../chapter-context'

/** A run of the chapter's entries the prose tasks read at once; `index` from 1 (C4). */
export type ClosePart = { index: number; entryIds: readonly string[] }

/**
 * Each stored cut's entries, its start through its end by position. Throws unless the cuts, from
 * part 1, cover `entries` end to end: a turn in no part would reach no prose task.
 */
export function closeParts(
  entries: readonly CloseRangeEntry[],
  cuts: readonly ChapterPartCut[],
): readonly ClosePart[] {
  const at = new Map(entries.map((entry, i) => [entry.id, i] as const))
  let next = 0
  const parts = cuts.map((cut, i): ClosePart => {
    const start = at.get(cut.startEntryId)
    const end = at.get(cut.endEntryId)
    if (cut.part !== i + 1 || start !== next || end === undefined || end < start)
      throw new RangeError(
        `close parts: part ${cut.part} (${cut.startEntryId} to ${cut.endEntryId}) doesn't follow the range's entries`,
      )
    next = end + 1
    return { index: cut.part, entryIds: entries.slice(start, end + 1).map((entry) => entry.id) }
  })
  if (next !== entries.length)
    throw new RangeError(`close parts: ${entries.length - next} of the range's entries in no part`)
  return parts
}
