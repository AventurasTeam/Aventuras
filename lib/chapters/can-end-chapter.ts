import type { StoryEntry } from '@/lib/db'

/** A chapter ends only on an `ai_reply`, auto and manual closes alike. */
export function canEndChapter(row: { kind: StoryEntry['kind'] }): boolean {
  return row.kind === 'ai_reply'
}

/** A row a chapter can end on now: an `ai_reply` in the open region, which no chapter holds. */
export function canEndInOpenRegion(row: Pick<StoryEntry, 'kind' | 'chapterId'>): boolean {
  return row.chapterId == null && canEndChapter(row)
}
