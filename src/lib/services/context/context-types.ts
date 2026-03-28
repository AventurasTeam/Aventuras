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

import type { Character, Item, StoryBeat, Location, Chapter, StoryEntry } from '$lib/types'

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
 * A story entry as seen by Liquid templates (storyEntries[]).
 * Narrow type union — system/retry types are filtered out by mappers before reaching templates.
 */
export type ContextStoryEntry = StoryEntry & {
  type: 'user_action' | 'narration'
}

/**
 * A chapter for timeline-fill-answer templates (answerChapters[]).
 * Slim subset with optional entries array for dual-mode rendering.
 */
export type ContextAnswerChapter = Pick<Chapter, 'number' | 'title' | 'summary'> & {
  /** Optional story entries within this chapter (for detailed answer mode) */
  entries?: ContextStoryEntry[]
}
