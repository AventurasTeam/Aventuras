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
 * - WorldStateInjector: Tiered live-WorldState injection for prompts
 */

// Narrative generation
export {
  NarrativeService,
  type NarrativeWorldState,
  type NarrativeOptions,
  type WorldStateContext,
  buildChapterSummariesBlock,
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

// World state injection
export {
  WorldStateInjector,
  DEFAULT_WORLD_STATE_INJECTOR_CONFIG,
  getWorldStateInjectorConfigFromSettings,
  type WorldStateInjectionResult,
  type WorldStateInjectorConfig,
  type WorldStateInjectorInput,
  type WorldStateInjectorOptions,
  type WorldStateContextEntry,
} from './WorldStateInjector'
