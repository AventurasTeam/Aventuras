import { canEndChapter } from '@/lib/chapters'
import type { StoryEntry } from '@/lib/db'

/** The rows `Close chapter here` may end on: open region (no chapterId), passing canEndChapter. */
export function closeHereEntryIds(
  rows: readonly Pick<StoryEntry, 'id' | 'kind' | 'chapterId'>[],
): Record<string, true> {
  const ids: Record<string, true> = {}
  for (const row of rows) {
    if (row.chapterId == null && canEndChapter(row)) ids[row.id] = true
  }
  return ids
}
