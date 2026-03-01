/**
 * AI Generation Module
 *
 * Story narrative generation services:
 * - AIService: Main orchestrator for all AI operations
 * - NarrativeService: Core narrative generation
 * - ClassifierService: Extract world state from narrative
 * - MemoryService: Chapter summarization and memory retrieval
 * - SuggestionsService: Story direction suggestions
 * - ActionChoicesService: RPG-style action choices
 * - StyleReviewerService: Writing style analysis
 * - EntryInjector: Tiered entry injection for prompts
 */

// Main orchestrator (exports singleton instance)
export { aiService } from '../index'

// Narrative generation
export {
  NarrativeService,
  type NarrativeWorldState,
  type NarrativeOptions,
  type WorldStateContext,
  buildChapterSummariesBlock,
  formatStoryTime,
} from './NarrativeService'

// Classification
export { ClassifierService, type ClassificationContext } from './ClassifierService'
// Classifier output types - import from schema
export type {
  ClassificationResult,
  EntryUpdates,
  Scene,
  CharacterUpdate,
  NewCharacter,
  LocationUpdate,
  NewLocation,
  ItemUpdate,
  NewItem,
  StoryBeatUpdate,
  NewStoryBeat,
} from '../sdk/schemas/classifier'

// Memory
export {
  MemoryService,
  DEFAULT_MEMORY_CONFIG,
  type RetrievedContext,
  type RetrievalContext,
} from './MemoryService'
// Memory output types - import from schema
export type {
  ChapterAnalysis,
  ChapterSummaryResult,
  RetrievalDecision,
} from '../sdk/schemas/memory'

// Suggestions and choices - types exported from schemas
export { SuggestionsService } from './SuggestionsService'
export type { Suggestion, SuggestionsResult } from '../sdk/schemas/suggestions'

export { ActionChoicesService } from './ActionChoicesService'
export type { ActionChoice, ActionChoicesResult } from '../sdk/schemas/actionchoices'

// Style analysis
export {
  StyleReviewerService,
  type StyleReviewResult,
  type PhraseAnalysis,
} from './StyleReviewerService'

// Entry injection
export {
  EntryInjector,
  DEFAULT_CONTEXT_CONFIG,
  type ContextResult,
  type ContextConfig,
  type WorldState,
  type RelevantEntry,
} from './EntryInjector'
