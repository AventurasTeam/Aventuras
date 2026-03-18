/**
 * Generation Pipeline Module
 *
 * Orchestrates the narrative generation pipeline including:
 * - Pre-generation setup (retry state, time tracking)
 * - Retrieval (memory, lorebook)
 * - Narrative streaming
 * - Classification (world state extraction)
 * - Translation (optional)
 * - Image generation (optional)
 * - Post-generation (suggestions, action choices)
 */

// Types
export type {
  GenerationPhase,
  RetrievalResult,
  PhaseStartEvent,
  PhaseCompleteEvent,
  NarrativeChunkEvent,
  NarrativeCompleteEvent,
  ClassificationCompleteEvent,
  ErrorEvent,
  AbortedEvent,
  GenerationEvent,
} from './types'

// Pipeline orchestrator
export { GenerationPipeline } from './GenerationPipeline'
export type { PipelineDependencies } from './GenerationPipeline'

// Phase services
export {
  PreGenerationPhase,
  RetrievalPhase,
  NarrativePhase,
  ClassificationPhase,
  TranslationPhase,
  ImagePhase,
  PostGenerationPhase,
} from './phases'
export type { RetryBackupData as PhaseRetryBackupData, PreGenerationResult } from './phases'

// Retry service
export { RetryService, retryService } from './RetryService'
export type { RetryBackupData, RetryStoreCallbacks, RestoreResult } from './RetryService'

// Chapter service
export { ChapterService } from './ChapterService'
export type {
  ChapterServiceDependencies,
  ChapterCheckInput,
  ChapterCreationResult,
  ChapterAnalysisResult,
  ChapterSummaryData,
} from './ChapterService'

// Lore management coordinator
export { LoreManagementCoordinator } from './LoreManagementCoordinator'
export type {
  LoreManagementCallbacks,
  LoreManagementUICallbacks,
  LoreSessionInput,
  LoreManagementDependencies,
  LoreSessionResult,
} from './LoreManagementCoordinator'

// Style review scheduler
export { StyleReviewScheduler } from './StyleReviewScheduler'
export type {
  StyleReviewDependencies,
  StyleReviewUICallbacks,
  StyleReviewCheckInput,
  StyleReviewCheckResult,
} from './StyleReviewScheduler'

// Background task coordinator
export { BackgroundTaskCoordinator } from './BackgroundTaskCoordinator'
export type {
  BackgroundTaskDependencies,
  BackgroundTaskInput,
  BackgroundTaskResult,
} from './BackgroundTaskCoordinator'

// World state translation service
export { WorldStateTranslationService } from './WorldStateTranslationService'
export type {
  ClassificationNewEntities,
  WorldStateEntities,
  WorldStateTranslationCallbacks,
  WorldStateTranslationDependencies,
  WorldStateTranslationInput,
  WorldStateTranslationResult,
} from './WorldStateTranslationService'

// Suggestions refresh service
export { SuggestionsRefreshService } from './SuggestionsRefreshService'
export type {
  SuggestionsRefreshDependencies,
  SuggestionsRefreshInput,
  SuggestionsRefreshResult,
} from './SuggestionsRefreshService'

// Pipeline event handler
export { handleEvent } from './PipelineEventHandler'
export type { PipelineUICallbacks, PipelineEventState } from './PipelineEventHandler'
export type { RetrievalDependencies } from './phases'
export type { NarrativeDependencies, NarrativeResult } from './phases'
export type { ClassificationDependencies, ClassificationPhaseResult } from './phases'
export type { TranslationDependencies, TranslationResult2 } from './phases'
export type { ImageDependencies, ImageSettings, ImageResult } from './phases'
export type { PromptContext, PostGenerationDependencies, PostGenerationResult } from './phases'
