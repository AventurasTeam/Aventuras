export { pipelineErrorDetail, toPipelineError } from './call-error'
export { definePhase, definePipeline } from './authoring/define'
export {
  EMPTY_REPLY,
  ensurePerTurnPipelineRegistered,
  PER_TURN_KIND,
  type PerTurnPhaseName,
} from './definitions/per-turn'
export { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
export {
  fallbackClassifierSchema,
  fallbackClassifierWithSuggestionsSchema,
} from './definitions/per-turn-piggyback'
export {
  __resetClassifierEmbedder,
  configureClassifierEmbedder,
} from './definitions/description-embedder'
export { readSceneSource } from './definitions/entry-reads'
export { ensurePeriodicClassifierPipelineRegistered } from './definitions/periodic-classifier'
export {
  CHAPTER_CLOSE_RESOLVES,
  ensureChapterClosePipelineRegistered,
} from './definitions/chapter-close'
export {
  CLASSIFIER_HELD,
  isClassifierHeld,
  owedPassAtSend,
  readClassifierStatus,
  unprocessedEntryCount,
} from './definitions/memory-chain'
export { runClassifierPass } from './definitions/classifier-pass'
export {
  ensureSuggestionRefreshPipelineRegistered,
  SUGGESTION_EMISSION_PHASE,
  SUGGESTION_REFRESH_KIND,
  SUGGESTION_TRANSLATION_PHASE,
  suggestionRefreshSchema,
  SUGGESTIONS_UNUSABLE,
  type SuggestionRefreshInput,
} from './definitions/suggestion-refresh'
export { chapterMetadataSchema, type ChapterMetadata } from './definitions/chapter-metadata-schema'
export { __resetRegistry, getPipeline, registerPipeline } from './authoring/registry'
export { __resetBus, pipelineEventBus } from './runtime/event-bus'
export {
  __resetDeltaActionPort,
  configureDeltaActionPort,
  type DeltaActionPort,
} from './runtime/action-port'
// awaitRunTerminal is deliberately absent: it lives in lib/stores/generation, beside
// interruptMemoryRuns, so callers can await a terminal without importing the orchestrator.
export {
  runPipeline,
  startPipeline,
  type ChainEnd,
  type PipelineStart,
  type RunCtx,
  type RunCtxFor,
} from './runtime/orchestrator'
export { recoverInFlightRuns } from './runtime/recovery'
export type {
  BootRecoveryReport,
  RecoveredRun,
  RecoveryFailure,
  RecoveryReport,
} from './runtime/recovery'
export type {
  ConcurrencyPolicy,
  PhaseContext,
  PhaseEmittedEvent,
  PhaseFn,
  PhaseNode,
  PhaseResult,
  Pipeline,
  PipelineError,
  PipelineEvent,
  PreflightSnapshot,
  RejectedStart,
  ResolverInput,
  TxResult,
} from './types'
