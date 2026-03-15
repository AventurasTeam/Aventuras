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
import type {
  ExpandedSetting,
  GeneratedProtagonist,
  GeneratedCharacter,
} from '$lib/services/ai/sdk/schemas/scenario'
import type { RuntimeVariable } from '$lib/services/packs/types'

// ===== Refactored Existing Interfaces (Omit<>/Pick<> derivation) =====

/**
 * A character as seen by Liquid templates (worldStateCharacters[]).
 * Explicit field list — new Character fields won't leak into templates.
 * `appearance` is normalized from VisualDescriptors; `tier` is retrieval priority.
 */
export type ContextCharacter = Pick<
  Character,
  'name' | 'description' | 'relationship' | 'traits'
> & {
  status: 'active' | 'inactive' | 'deceased'
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
export type ContextItem = Pick<Item, 'name' | 'description' | 'quantity' | 'equipped'> & {
  /** Retrieval tier — present for tier-2/3 items (worldStateRelevantItems), omitted for inventory */
  tier?: 1 | 2 | 3
}

/**
 * A story beat/active thread as seen by Liquid templates (worldStateBeats[]).
 * Strips internal IDs, branch tracking, timestamps, and translation fields.
 * Adds optional `tier` for tier-2/3 related beats.
 */
export type ContextStoryBeat = Pick<StoryBeat, 'title' | 'description' | 'type' | 'status'> & {
  /** Retrieval tier — present for tier-2/3 beats (worldStateRelatedBeats), omitted for active beats */
  tier?: 1 | 2 | 3
}

/**
 * A non-current location as seen by Liquid templates (worldStateLocations[]).
 * Strips internal IDs, branch tracking, connections, current flag, and translation fields.
 * Adds `tier` for retrieval priority ordering.
 */
export type ContextLocation = Pick<Location, 'name' | 'description' | 'visited'> & {
  /** Retrieval tier — lower means higher priority in context window */
  tier: 1 | 2 | 3
}

/**
 * A lorebook entry as seen by Liquid templates (lorebookEntries[]).
 * Uses Pick — only 3 fields needed from the large Entry type.
 * Adds `tier` and optional `disposition` for character entries.
 */
export type ContextLorebookEntry = Pick<Entry, 'name' | 'type' | 'description'> & {
  /** Retrieval tier — lower means higher priority. Optional: wizards omit tier. */
  tier?: 1 | 2 | 3
  /** Current disposition — optional, character-only */
  disposition?: string
  /** Hidden lore visible only to the AI — optional, wizard-only */
  hiddenInfo?: string
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
export type ContextStoryEntry = {
  type: 'user_action' | 'narration'
  content: string
}

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
 * Only type and content are needed by templates; timeStart is computed by the mapper
 * from the source entry's metadata.timeStart.
 */
export type ContextChatEntry = Pick<StoryEntry, 'type' | 'content'> & {
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
 */
export type ContextSceneCharacter = Pick<
  Character,
  'name' | 'description' | 'relationship' | 'traits' | 'visualDescriptors' | 'portrait' | 'status'
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

// ===== v1.3 Wizard Context Types =====

/**
 * A setting as seen by wizard templates (currentSetting{}).
 * Structured object fields for Liquid field access — no pre-formatted string.
 */
export type ContextWizardSetting = Pick<
  ExpandedSetting,
  'name' | 'description' | 'atmosphere' | 'themes' | 'potentialConflicts' | 'keyLocations'
>

/**
 * A protagonist as seen by wizard templates (currentCharacter{}, characterInput{}).
 * Structured object fields for Liquid field access — no pre-formatted string.
 */
export type ContextWizardCharacter = Pick<
  GeneratedProtagonist,
  'name' | 'description' | 'background' | 'motivation' | 'traits' | 'appearance'
>

/**
 * A supporting character as seen by wizard templates (supportingCharacters[]).
 * Structured array element for Liquid for-loop iteration — no pre-joined string.
 */
export type ContextSupportingCharacter = Pick<
  GeneratedCharacter,
  'name' | 'role' | 'description' | 'relationship' | 'traits'
>

// ===== v1.3 Classifier Context Types =====

/**
 * A runtime variable definition as seen by classifier templates (runtimeVariables{}).
 * Full RuntimeVariable objects are passed through — template ignores extra fields.
 */
export type ContextRuntimeVariable = Pick<
  RuntimeVariable,
  | 'variableName'
  | 'variableType'
  | 'minValue'
  | 'maxValue'
  | 'enumOptions'
  | 'defaultValue'
  | 'description'
>
