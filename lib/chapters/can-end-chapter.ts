import type { StoryEntry } from '@/lib/db'

/** A chapter ends only on an `ai_reply`, auto and manual closes alike. */
export function canEndChapter(row: { kind: StoryEntry['kind'] }): boolean {
  return row.kind === 'ai_reply'
}
