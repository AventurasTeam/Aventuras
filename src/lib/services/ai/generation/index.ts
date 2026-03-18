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

// Memory
export {
  MemoryService,
  DEFAULT_MEMORY_CONFIG,
  type RetrievedContext,
  type RetrievalContext,
} from './MemoryService'

// Suggestions and choices - types exported from schemas
export { SuggestionsService } from './SuggestionsService'

export { ActionChoicesService } from './ActionChoicesService'

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
