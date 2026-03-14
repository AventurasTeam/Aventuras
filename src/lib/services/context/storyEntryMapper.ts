/**
 * Story Entry Mapper
 *
 * Pure transformation function that converts raw StoryEntry[] into typed
 * ContextStoryEntry[] arrays suitable for Liquid template variables.
 *
 * This is the data layer bridge between the story entry pipeline and
 * the template context builder (ContextBuilder).
 */

import type { StoryEntry } from '$lib/types'
import type { ContextStoryEntry } from './context-types'
import { stripPicTags as stripPics } from '$lib/utils/inlineImageParser'

export interface StoryEntryMapOptions {
  /** Whether to strip <pic> tags from entry content */
  stripPicTags: boolean
  /** Limit to last N entries (undefined = include all) */
  maxEntries?: number
}

/**
 * Map StoryEntry[] into typed ContextStoryEntry[] suitable for Liquid
 * template injection.
 *
 * - Optionally slices to the last maxEntries entries
 * - Optionally strips <pic> tags from content
 *
 * @param entries - Raw StoryEntry[] from the story pipeline
 * @param options - Mapping options (stripPicTags, maxEntries)
 * @returns ContextStoryEntry[] ready for template context injection
 */
export function mapStoryEntriesToContext(
  entries: StoryEntry[],
  options: StoryEntryMapOptions,
): ContextStoryEntry[] {
  const sliced = options.maxEntries ? entries.slice(-options.maxEntries) : entries
  return sliced.map((e) => ({
    type: e.type as 'user_action' | 'narration',
    content: options.stripPicTags ? stripPics(e.content) : e.content,
  }))
}
