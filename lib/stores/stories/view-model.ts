import type { Story } from '@/lib/db'
import { relativeTimeLabel, t } from '@/lib/i18n'

export type StoryCardData = Story & { lastOpenedRelative: string; chapterLabel: string | null }

/** Augments a story row with the two derived display strings the card can't read off the row
 *  (date formatting + chapter label). Keeps the card clock-free / date-library agnostic. */
export function toStoryCardData(row: Story, nowMs: number): StoryCardData {
  return {
    ...row,
    lastOpenedRelative:
      row.lastOpenedAt == null
        ? t('storyCard.neverOpened')
        : relativeTimeLabel(row.lastOpenedAt, nowMs),
    chapterLabel: null,
  }
}
