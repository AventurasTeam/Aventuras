import type { Story } from '@/lib/db'

import { formatRelativeTime } from './relative-time'

export type StoryCardData = Story & { lastOpenedRelative: string; chapterLabel: string | null }

/** Augments a story row with the two derived display strings the card can't read off the row
 *  (date formatting + chapter label). Keeps the card clock-free / date-library agnostic. */
export function toStoryCardData(row: Story, nowSec: number): StoryCardData {
  return {
    ...row,
    lastOpenedRelative: formatRelativeTime(row.lastOpenedAt, nowSec),
    chapterLabel: null,
  }
}
