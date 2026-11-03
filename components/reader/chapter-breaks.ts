import type { Chapter, StoryEntry } from '@/lib/db'

import type { WorldTimeDecoration } from './worldtime-decoration'

/** `number` names the chapter that follows the break; `timeLabel` is the time at close. */
export type ChapterBreak = { number: number; timeLabel?: string }
export type ChapterBreaks = Record<string, ChapterBreak>

// Branch copies share entry ids, so an id alone can match another branch's row.
const rowKey = (branchId: string, entryId: string) => `${branchId}\n${entryId}`

export function chapterBreaksOf(
  chapters: readonly Chapter[],
  rows: readonly StoryEntry[],
  decorations: Record<string, WorldTimeDecoration>,
): ChapterBreaks {
  const loaded = new Set(rows.map((row) => rowKey(row.branchId, row.id)))
  const breaks: ChapterBreaks = {}
  for (const chapter of chapters) {
    if (!loaded.has(rowKey(chapter.branchId, chapter.endEntryId))) continue
    const timeLabel = decorations[chapter.endEntryId]?.label
    breaks[chapter.endEntryId] = {
      number: chapter.sequenceNumber + 1,
      ...(timeLabel != null ? { timeLabel } : {}),
    }
  }
  return breaks
}
