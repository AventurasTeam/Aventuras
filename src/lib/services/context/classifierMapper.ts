/**
 * Classifier Mapper
 *
 * Pure transformation functions that map domain types to the context shapes
 * expected by classifier Liquid templates.
 *
 * All functions are stateless and side-effect-free.
 */

import type { StoryBeat, StoryEntry } from '$lib/types'
import type { ContextClassifierBeat, ContextChatEntry } from './context-types'
import { stripPicTags } from '$lib/utils/inlineImageParser'

/**
 * Map an array of StoryBeat domain objects to ContextClassifierBeat context shapes.
 *
 * Picks only the four fields needed for classification: title, description, type, status.
 * Null description is coalesced to empty string.
 */
export function mapBeats(beats: StoryBeat[]): ContextClassifierBeat[] {
  return beats.map(
    (b) =>
      ({
        title: b.title,
        description: b.description ?? '',
        type: b.type,
        status: b.status,
      }) satisfies ContextClassifierBeat,
  )
}

/** Options for mapChatEntries behavior */
export interface MapChatEntriesOptions {
  /** Truncate content to 500 chars with '...' suffix (default: true) */
  truncate?: boolean
  /** Strip <pic> tags from content (default: true) */
  stripPicTags?: boolean
}

/**
 * Map an array of StoryEntry domain objects to ContextChatEntry context shapes.
 *
 * Used by ClassifierService and ImageAnalysisService for the chatHistory[] context variable.
 * Caller is responsible for truncating entry count before calling (service responsibility).
 *
 * - Optionally strips pic tags from content (default: true)
 * - Optionally truncates content to 500 chars with '...' suffix (default: true)
 * - Formats timeStart from metadata.timeStart as 'YxDy HH:MM', or '' if not present
 */
export function mapChatEntries(
  entries: StoryEntry[],
  options: MapChatEntriesOptions = {},
): ContextChatEntry[] {
  const { truncate = true, stripPicTags: shouldStripPics = true } = options

  return entries.map((e) => {
    let content = shouldStripPics ? stripPicTags(e.content) : e.content
    if (truncate && content.length > 500) {
      content = content.slice(0, 500) + '...'
    }

    const ts = e.metadata?.timeStart
    const timeStart = ts
      ? `Y${ts.years}D${ts.days} ${String(ts.hours).padStart(2, '0')}:${String(ts.minutes).padStart(2, '0')}`
      : ''

    return {
      type: e.type,
      content,
      timeStart,
    } satisfies ContextChatEntry
  })
}
