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

/** A character as seen by Liquid templates (worldStateCharacters[]) */
export interface ContextCharacter {
  /** Character name */
  name: string
  /** Relationship to the protagonist (e.g. companion, rival, ally, self) */
  relationship: string
  /** Character description */
  description: string
  /** Personality traits */
  traits: string[]
  /** Visual appearance details (normalized from VisualDescriptors) */
  appearance: string[]
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
  /** Character status */
  status: 'active' | 'inactive' | 'deceased'
}

/** An inventory item as seen by Liquid templates (worldStateInventory[]) */
export interface ContextItem {
  /** Item name */
  name: string
  /** Item description */
  description: string
  /** Quantity held */
  quantity: number
  /** Whether the item is currently equipped */
  equipped: boolean
  /** Retrieval tier — present for tier-2/3 items (worldStateRelevantItems), omitted for inventory */
  tier?: 1 | 2 | 3
}

/** A story beat/active thread as seen by Liquid templates (worldStateBeats[]) */
export interface ContextStoryBeat {
  /** Beat title */
  title: string
  /** Beat description */
  description: string
  /** Beat type (e.g. discovery, conflict, quest, revelation) */
  type: string
  /** Beat status (e.g. active, completed, failed) */
  status: string
  /** Retrieval tier — present for tier-2/3 beats (worldStateRelatedBeats), omitted for active beats */
  tier?: 1 | 2 | 3
}

/** A non-current location as seen by Liquid templates (worldStateLocations[]) */
export interface ContextLocation {
  /** Location name */
  name: string
  /** Location description */
  description: string
  /** Whether the protagonist has visited this location */
  visited: boolean
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
}

/** A lorebook entry as seen by Liquid templates (lorebookEntries[]) */
export interface ContextLorebookEntry {
  /** Entry name */
  name: string
  /** Entry type (e.g. character, location, item, faction, concept, event) */
  type: string
  /** Entry description */
  description: string
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
  /** Current disposition — optional, character-only */
  disposition?: string
}

/** A chapter summary as seen by Liquid templates (chapters[]) */
export interface ContextChapter {
  /** Chapter number */
  number: number
  /** Chapter title */
  title: string
  /** Chapter summary text */
  summary: string
  /** Formatted start time string, or null if not recorded */
  startTime: string | null
  /** Formatted end time string, or null if not recorded */
  endTime: string | null
  /** Character names appearing in this chapter */
  characters: string[]
  /** Location names appearing in this chapter */
  locations: string[]
  /** Emotional tone of the chapter */
  emotionalTone: string
}

/** A timeline gap-fill Q&A result as seen by Liquid templates (timelineFill[]) */
export interface ContextTimelineFill {
  /** The question posed to fill the timeline gap */
  query: string
  /** The generated answer */
  answer: string
  /** Chapter numbers this result covers */
  chapterNumbers: number[]
}

/** A story entry as seen by Liquid templates (storyEntries[]) */
export interface ContextStoryEntry {
  /** Entry type */
  type: 'user_action' | 'narration'
  /** Entry text content */
  content: string
}
