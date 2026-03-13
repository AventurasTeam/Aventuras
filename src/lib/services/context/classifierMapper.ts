/**
 * Classifier Mapper
 *
 * Pure transformation functions that map domain types to the context shapes
 * expected by classifier Liquid templates.
 *
 * All functions are stateless and side-effect-free.
 */

import type { Character, StoryBeat, StoryEntry } from '$lib/types'
import type {
  ContextClassifierCharacter,
  ContextClassifierBeat,
  ContextChatEntry,
} from './context-types'
import { normalizeAppearance } from './context-utils'
import { stripPicTags } from '$lib/utils/inlineImageParser'

/**
 * Map an array of Character domain objects to ContextClassifierCharacter context shapes.
 *
 * Strips IDs, timestamps, and translation fields.
 * Normalizes visualDescriptors into a flat appearance string[].
 * Defaults tier to 1 — classifier processes full active roster, no retrieval ranking.
 */
export function mapCharacters(characters: Character[]): ContextClassifierCharacter[] {
  return characters.map(
    (c) =>
      ({
        name: c.name,
        description: c.description ?? '',
        relationship: c.relationship ?? '',
        traits: c.traits ?? [],
        appearance: normalizeAppearance(c.visualDescriptors),
        status: c.status,
        tier: 1,
      }) satisfies ContextClassifierCharacter,
  )
}

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

/**
 * Map an array of StoryEntry domain objects to ContextChatEntry context shapes.
 *
 * Used by ClassifierService for the chatHistory[] context variable.
 * Caller is responsible for truncating entry count before calling (service responsibility).
 *
 * - Strips pic tags from content
 * - Truncates content to 500 chars (with '...' suffix if truncated)
 * - Formats timeStart from metadata.timeStart as 'YxDy HH:MM', or '' if not present
 */
export function mapChatEntries(entries: StoryEntry[]): ContextChatEntry[] {
  return entries.map((e) => {
    const stripped = stripPicTags(e.content)
    const content = stripped.length > 500 ? stripped.slice(0, 500) + '...' : stripped

    const ts = e.metadata?.timeStart
    const timeStart = ts
      ? `Y${ts.years}D${ts.days} ${String(ts.hours).padStart(2, '0')}:${String(ts.minutes).padStart(2, '0')}`
      : ''

    return {
      type: e.type,
      content,
      metadata: e.metadata,
      timeStart,
    } satisfies ContextChatEntry
  })
}

/**
 * Map an array of StoryEntry domain objects to ContextChatEntry context shapes.
 *
 * Picks only type and content — minimal shape for classifier context.
 * Does NOT strip pic tags — that is the caller's responsibility.
 * Does NOT import from storyEntryMapper — no cross-mapper dependency.
 *
 * @deprecated Use mapChatEntries for full ContextChatEntry shape with timeStart support.
 */
export function mapEntries(entries: StoryEntry[]): ContextChatEntry[] {
  return entries.map((e) => ({
    type: e.type,
    content: e.content,
    metadata: e.metadata,
    timeStart: '',
  }))
}
