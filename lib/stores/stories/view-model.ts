import type { Story } from '@/lib/db'
import { relativeTimeLabel, t } from '@/lib/i18n'

export type StoryCardData = Story & { lastOpenedRelative: string; chapterLabel: string | null }

// A null map is a read that hasn't landed: no label, so a story with chapters never flashes
// `Chapter 1`. A loaded map with no key is a story with no closed chapter.
function chapterLabelOf(
  row: Story,
  chapterNumbers: ReadonlyMap<string, number> | null,
): string | null {
  if (chapterNumbers == null || row.status === 'draft') return null
  return t('chapters:label', { number: chapterNumbers.get(row.id) ?? 1 })
}

/** Augments a story row with the two derived display strings the card can't read off the row
 *  (date formatting + chapter label). Keeps the card clock-free / date-library agnostic. */
export function toStoryCardData(
  row: Story,
  nowMs: number,
  chapterNumbers: ReadonlyMap<string, number> | null,
): StoryCardData {
  return {
    ...row,
    lastOpenedRelative:
      row.lastOpenedAt == null
        ? t('storyCard.neverOpened')
        : relativeTimeLabel(row.lastOpenedAt, nowMs),
    chapterLabel: chapterLabelOf(row, chapterNumbers),
  }
}
