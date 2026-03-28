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

/**
 * All world state arrays produced by EntryInjector.buildContext().
 * Uses full domain types — templates access only the fields they need.
 */
export interface WorldStateArrays {
  /** All characters from all tiers, ordered by tier then priority */
  characters: Character[]
  /** Tier-1 items (player inventory) */
  inventory: Item[]
  /** Tier-2/3 items (contextually relevant, not held) */
  relevantItems: Item[]
  /** Tier-1 story beats (active threads) */
  storyBeats: StoryBeat[]
  /** Tier-2/3 story beats (related threads) */
  relatedStoryBeats: StoryBeat[]
  /** Tier-2/3 non-current locations */
  locations: Location[]
}

/**
 * Base lorebook entry fields shared by all context paths (retrieval, wizard, agentic).
 */
export type ContextLorebookEntryBase = Pick<Entry, 'name' | 'type' | 'description'> & {
  /** Current disposition — optional, character-only */
  disposition?: string
}

/**
 * A lorebook entry for retrieval templates (lorebookEntries[]).
 * Tier is required — retrieval always assigns priority tiers.
 */
export type ContextLorebookEntry = ContextLorebookEntryBase & {
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
}

/**
 * A chapter summary as seen by Liquid templates (chapters[]).
 * Strips internal IDs, branch tracking, entry boundary IDs, keyword/thread metadata.
 * Converts TimeTracker startTime/endTime to formatted string | null for template rendering.
 */
export type ContextChapter = Pick<Chapter, 'number' | 'summary' | 'characters' | 'locations'> & {
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
 * Narrow type union — system/retry types are filtered out by mappers before reaching templates.
 */
export type ContextStoryEntry = StoryEntry & {
  type: 'user_action' | 'narration'
}

/**
 * A story beat subset for classifier templates (storyBeats[]).
 * Slim subset for classification — only title, description, type, status needed.
 */
export type ContextClassifierBeat = Pick<StoryBeat, 'title' | 'description' | 'type' | 'status'>

/**
 * A chat entry for classifier/image templates (chatHistory[]).
 * Only type and content are needed by templates; timeStart is computed by the mapper
 * from the source entry's metadata.timeStart.
 */
export type ContextChatEntry = Pick<StoryEntry, 'type' | 'content'> & {
  /** Formatted time string for template rendering, e.g. 'Y1D3 09:30', empty string if none */
  timeStart: string
}

/**
 * A chapter for timeline-fill-answer templates (answerChapters[]).
 * Slim subset with optional entries array for dual-mode rendering.
 */
export type ContextAnswerChapter = Pick<Chapter, 'number' | 'title' | 'summary'> & {
  /** Optional story entries within this chapter (for detailed answer mode) */
  entries?: ContextStoryEntry[]
}

