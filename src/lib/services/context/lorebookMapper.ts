/**
 * Lorebook Mapper
 *
 * Extracts Entry[] from EntryRetrievalService results with optional
 * description truncation for context window budgeting.
 */

import type { Entry } from '$lib/types'
import type { EntryRetrievalResult } from '$lib/services/ai/retrieval/EntryRetrievalService'

/**
 * Truncate entry text to a maximum word count.
 *
 * @param text - The text to truncate
 * @param maxWords - Maximum number of words (0 or negative = no limit)
 * @returns Original text or truncated text with ellipsis
 */
function truncateEntryText(text: string, maxWords: number): string {
  if (!maxWords || maxWords <= 0) return text
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ') + '...'
}

/**
 * Extract Entry[] from an EntryRetrievalResult, optionally truncating descriptions.
 *
 * @param result - Output from EntryRetrievalService
 * @param maxWordsPerEntry - Maximum words per entry description (0 = unlimited)
 * @returns Array of Entry objects ready for template injection
 */
export function mapEntryRetrievalToLorebookEntries(
  result: EntryRetrievalResult,
  maxWordsPerEntry: number,
): Entry[] {
  if (!maxWordsPerEntry || maxWordsPerEntry <= 0) {
    return result.all.map((r) => r.entry)
  }

  return result.all.map(({ entry }) => ({
    ...entry,
    description: truncateEntryText(entry.description ?? '', maxWordsPerEntry),
  }))
}
