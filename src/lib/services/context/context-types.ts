/**
 * Context-Layer Interfaces
 *
 * Lean projections of domain types for use in Liquid templates.
 * These are NOT the same as the full domain types in src/lib/types/index.ts —
 * they strip internal IDs, timestamps, and branchIds to expose only what
 * template authors need.
 *
 * Used by the context builder to populate structured array variables
 * (worldStateCharacters[], worldStateInventory[], etc.) in the template context.
 */

import type { Character, Item, StoryBeat, Location, Entry, Chapter, StoryEntry } from '$lib/types'

// ===== Refactored Existing Interfaces (Omit<>/Pick<> derivation) =====

/**
 * A character as seen by Liquid templates (worldStateCharacters[]).
 * Strips internal IDs, branch tracking, and translation fields.
 * Adds `appearance` (normalized from VisualDescriptors) and `tier`.
 */
export type ContextCharacter = Omit<
  Character,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'overridesId'
  | 'deleted'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'portrait'
  | 'visualDescriptors'
  | 'translatedName'
  | 'translatedDescription'
  | 'translatedRelationship'
  | 'translatedTraits'
  | 'translatedVisualDescriptors'
  | 'translationLanguage'
> & {
  /** Visual appearance details (normalized from VisualDescriptors) */
  appearance: string[]
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
}

/**
 * An inventory item as seen by Liquid templates (worldStateInventory[]).
 * Strips internal IDs, branch tracking, location, and translation fields.
 * Adds optional `tier` for tier-2/3 relevant items.
 */
export type ContextItem = Omit<
  Item,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'overridesId'
  | 'deleted'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'location'
  | 'translatedName'
  | 'translatedDescription'
  | 'translationLanguage'
> & {
  /** Retrieval tier — present for tier-2/3 items (worldStateRelevantItems), omitted for inventory */
  tier?: 1 | 2 | 3
}

/**
 * A story beat/active thread as seen by Liquid templates (worldStateBeats[]).
 * Strips internal IDs, branch tracking, timestamps, and translation fields.
 * Adds optional `tier` for tier-2/3 related beats.
 */
export type ContextStoryBeat = Omit<
  StoryBeat,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'overridesId'
  | 'deleted'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'triggeredAt'
  | 'resolvedAt'
  | 'translatedTitle'
  | 'translatedDescription'
  | 'translationLanguage'
> & {
  /** Retrieval tier — present for tier-2/3 beats (worldStateRelatedBeats), omitted for active beats */
  tier?: 1 | 2 | 3
}

/**
 * A non-current location as seen by Liquid templates (worldStateLocations[]).
 * Strips internal IDs, branch tracking, connections, current flag, and translation fields.
 * Adds `tier` for retrieval priority ordering.
 */
export type ContextLocation = Omit<
  Location,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'overridesId'
  | 'deleted'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'connections'
  | 'current'
  | 'translatedName'
  | 'translatedDescription'
  | 'translationLanguage'
> & {
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
}

/**
 * A lorebook entry as seen by Liquid templates (lorebookEntries[]).
 * Uses Pick — only 3 fields needed from the large Entry type.
 * Adds `tier` and optional `disposition` for character entries.
 */
export type ContextLorebookEntry = Pick<Entry, 'name' | 'type' | 'description'> & {
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
  /** Current disposition — optional, character-only */
  disposition?: string
}

/**
 * A chapter summary as seen by Liquid templates (chapters[]).
 * Strips internal IDs, branch tracking, entry boundary IDs, keyword/thread metadata.
 * Converts TimeTracker startTime/endTime to formatted string | null for template rendering.
 */
export type ContextChapter = Omit<
  Chapter,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'createdAt'
  | 'startEntryId'
  | 'endEntryId'
  | 'entryCount'
  | 'keywords'
  | 'plotThreads'
  | 'startTime'
  | 'endTime'
  | 'title'
  | 'emotionalTone'
> & {
  /** Chapter title */
  title: string
  /** Formatted start time string, or null if not recorded */
  startTime: string | null
  /** Formatted end time string, or null if not recorded */
  endTime: string | null
  /** Emotional tone of the chapter */
  emotionalTone: string
}

/**
 * A timeline gap-fill Q&A result as seen by Liquid templates (timelineFill[]).
 * No direct domain type mapping — this is a pure context construct.
 */
export interface ContextTimelineFill {
  /** The question posed to fill the timeline gap */
  query: string
  /** The generated answer */
  answer: string
  /** Chapter numbers this result covers */
  chapterNumbers: number[]
}

/**
 * A story entry as seen by Liquid templates (storyEntries[]).
 * Uses Pick — only type and content needed from the full StoryEntry type.
 */
export type ContextStoryEntry = Pick<StoryEntry, 'type' | 'content'>

// ===== New v1.2 Interfaces =====

/**
 * A character subset for classifier templates (characters[]).
 * Full character context needed for entity classification.
 * Reuses ContextCharacter — classifier can tolerate all fields.
 */
export type ContextClassifierCharacter = ContextCharacter

/**
 * A story beat subset for classifier templates (storyBeats[]).
 * Slim subset for classification — only title, description, type, status needed.
 */
export type ContextClassifierBeat = Pick<StoryBeat, 'title' | 'description' | 'type' | 'status'>

/**
 * A chat entry for classifier/image templates (chatHistory[]).
 * Extended from StoryEntry — strips IDs and tracking fields, adds timeStart for template rendering.
 * The metadata field is retained so mappers can read it; templates use timeStart directly.
 */
export type ContextChatEntry = Omit<
  StoryEntry,
  'id' | 'storyId' | 'branchId' | 'parentId' | 'position' | 'createdAt'
> & {
  /** Formatted time string for template rendering, e.g. 'Y1D3 09:30', empty string if none */
  timeStart: string
}

/**
 * A passage for style review templates (passages[]).
 * No direct domain type mapping — content + reference entry ID.
 */
export interface ContextPassage {
  /** Passage text content */
  content: string
  /** ID of the source story entry */
  entryId: string
}

/**
 * An available lorebook entry for tier-3 entry selection (availableEntries[]).
 * Slim subset from Entry — name, type, description plus optional keywords string.
 */
export type ContextAvailableEntry = Pick<Entry, 'name' | 'type' | 'description'> & {
  /** Comma-separated keywords for matching (optional) */
  keywords?: string
}

/**
 * A story entry for retrieval/memory range queries (messagesInRange[]).
 * Same shape as ContextStoryEntry — type alias for semantic clarity.
 */
export type ContextMessagesInRange = ContextStoryEntry

/**
 * A story entry for chapter summarization (chapterEntries[]).
 * Same shape as ContextStoryEntry — type alias for semantic clarity.
 */
export type ContextChapterEntry = ContextStoryEntry

/**
 * A previous chapter for chapter summarization context (previousChapters[]).
 * Same shape as ContextChapter — type alias for semantic clarity.
 */
export type ContextPreviousChapter = ContextChapter

/**
 * A lorebook entry for lore management templates (loreEntries[]).
 * Uses Pick — name, type, description plus optional current state.
 */
export type ContextLoreEntry = Pick<Entry, 'name' | 'type' | 'description'> & {
  /** Current dynamic state of the entry (optional) */
  state?: string
}

/**
 * A chapter summary for lore management templates (loreChapters[]).
 * Slim subset — only number, title, summary needed for lore context.
 */
export type ContextLoreChapter = Pick<Chapter, 'number' | 'title' | 'summary'>

/**
 * A character for image generation templates (sceneCharacters[]).
 * Keeps visualDescriptors and portrait for image prompt construction.
 * Strips internal IDs, branch tracking, and translation fields only.
 */
export type ContextSceneCharacter = Omit<
  Character,
  | 'id'
  | 'storyId'
  | 'branchId'
  | 'overridesId'
  | 'deleted'
  | 'createdAt'
  | 'updatedAt'
  | 'metadata'
  | 'translatedName'
  | 'translatedDescription'
  | 'translatedRelationship'
  | 'translatedTraits'
  | 'translatedVisualDescriptors'
  | 'translationLanguage'
>

/**
 * A chapter for timeline-fill-answer templates (answerChapters[]).
 * Slim subset with optional entries array for dual-mode rendering.
 */
export type ContextAnswerChapter = Pick<Chapter, 'number' | 'title' | 'summary'> & {
  /** Optional story entries within this chapter (for detailed answer mode) */
  entries?: ContextStoryEntry[]
}

/**
 * A chapter for agentic retrieval templates (agenticChapters[]).
 * Same shape as ContextLoreChapter — type alias for semantic clarity.
 */
export type ContextAgenticChapter = ContextLoreChapter

/**
 * A lorebook entry for agentic retrieval templates (agenticEntries[]).
 * Slim subset — name and type only.
 */
export type ContextAgenticEntry = Pick<Entry, 'name' | 'type'>
