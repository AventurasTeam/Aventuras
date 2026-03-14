/**
 * Lorebook Mapper
 *
 * Pure transformation functions that convert EntryRetrievalService results
 * into typed ContextLorebookEntry arrays suitable for Liquid template variables.
 *
 * This is the data layer bridge between the lorebook retrieval pipeline
 * (EntryRetrievalService) and the template context builder (ContextBuilder).
 */

import type { ContextLorebookEntry } from './context-types'
import type {
  EntryRetrievalResult,
  RetrievedEntry,
} from '$lib/services/ai/retrieval/EntryRetrievalService'

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
 * Map a RetrievedEntry array into ContextLorebookEntry objects.
 *
 * Maps each entry into the lean projection shape that Liquid templates expect.
 * Character entries with a currentDisposition get a disposition field; all
 * other entries omit it.
 *
 * @param entries - Array of RetrievedEntry (from EntryRetrievalService)
 * @param maxWordsPerEntry - Maximum words per entry description (0 = unlimited)
 * @returns Flat array of ContextLorebookEntry ready for template injection
 */
export function mapRetrievedEntries(
  entries: RetrievedEntry[],
  maxWordsPerEntry: number = 0,
): ContextLorebookEntry[] {
  return entries.map(({ entry, tier }: RetrievedEntry): ContextLorebookEntry => {
    const base: ContextLorebookEntry = {
      name: entry.name,
      type: entry.type,
      description: truncateEntryText(entry.description ?? '', maxWordsPerEntry),
      tier,
    }

    if (
      entry.type === 'character' &&
      entry.state?.type === 'character' &&
      entry.state.currentDisposition
    ) {
      base.disposition = entry.state.currentDisposition
    }

    return base
  })
}

/**
 * Map an EntryRetrievalResult into a flat array of ContextLorebookEntry objects.
 *
 * Convenience wrapper around mapRetrievedEntries that extracts result.all.
 *
 * @param result - Output from EntryRetrievalService
 * @param maxWordsPerEntry - Maximum words per entry description (0 = unlimited)
 * @returns Flat array of ContextLorebookEntry ready for template injection
 */
export function mapEntryRetrievalToLorebookEntries(
  result: EntryRetrievalResult,
  maxWordsPerEntry: number,
): ContextLorebookEntry[] {
  return mapRetrievedEntries(result.all, maxWordsPerEntry)
}

/**
 * Slice a lorebook entry array to a maximum count for context window budgeting.
 *
 * Entries are already ordered by tier and priority from mapEntryRetrievalToLorebookEntries,
 * so slicing from the front preserves the highest-priority entries.
 *
 * @param entries - Array of ContextLorebookEntry (typically from mapEntryRetrievalToLorebookEntries)
 * @param maxEntries - Maximum entries to include
 * @returns Sliced array of at most maxEntries entries
 */
export function prepareLorebookForContext(
  entries: ContextLorebookEntry[],
  maxEntries: number,
): ContextLorebookEntry[] {
  return entries.slice(0, maxEntries)
}
