import type { StoryEntry } from '$lib/types'
import {
  CLEAN_FOR_REVIEW,
  cleanNarration,
  type NarrationCleanOptions,
} from '$lib/utils/narrationClean'

/**
 * The passages the Style Reviewer reads: the last `recentEntriesCount` narration entries
 * that still have text once cleaned, oldest first, numbered after the empty ones are gone.
 */
export function buildReviewPassages(
  entries: StoryEntry[],
  recentEntriesCount: number,
  options: NarrationCleanOptions = CLEAN_FOR_REVIEW,
): { passages: string; count: number } {
  const cleaned: string[] = []
  for (let i = entries.length - 1; i >= 0 && cleaned.length < recentEntriesCount; i--) {
    if (entries[i].type !== 'narration') continue
    const text = cleanNarration(entries[i].content, options)
    if (text) cleaned.push(text)
  }
  cleaned.reverse()

  return {
    passages: cleaned.map((text, i) => `--- Passage ${i + 1} ---\n${text}`).join('\n\n'),
    count: cleaned.length,
  }
}
