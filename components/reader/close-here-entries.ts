import { canEndInOpenRegion } from '@/lib/chapters'
import type { StoryEntry } from '@/lib/db'

/** The rows `Close chapter here` may end on. */
export function closeHereEntryIds(
  rows: readonly Pick<StoryEntry, 'id' | 'kind' | 'chapterId'>[],
): Record<string, true> {
  const ids: Record<string, true> = {}
  for (const row of rows) {
    if (canEndInOpenRegion(row)) ids[row.id] = true
  }
  return ids
}
