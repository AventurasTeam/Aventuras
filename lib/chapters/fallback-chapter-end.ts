import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'

/**
 * chapter-close.md → Phase 1, with no candidate: the latest row that may end a chapter before the
 * head, else the head if it may, else null. `series` oldest first, as `openRegionSeries` reads it.
 */
export function fallbackChapterEnd<R extends { id: string; kind: StoryEntry['kind'] }>(
  series: readonly R[],
): R | null {
  for (let i = series.length - 2; i >= 0; i--) {
    if (canEndChapter(series[i])) return series[i]
  }
  const head = series.at(-1)
  return head !== undefined && canEndChapter(head) ? head : null
}
