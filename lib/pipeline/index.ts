export { toPipelineError } from './call-error'
export { definePhase, definePipeline } from './authoring/define'
export {
  ensurePerTurnPipelineRegistered,
  PER_TURN_KIND,
  type PerTurnPhaseName,
} from './definitions/per-turn'
export {
  fallbackClassifierSchema,
  fallbackClassifierWithSuggestionsSchema,
} from './definitions/per-turn-piggyback'
export {
  __resetClassifierEmbedder,
  configureClassifierEmbedder,
  ensurePeriodicClassifierPipelineRegistered,
} from './definitions/periodic-classifier'
export {
  ensureSuggestionRefreshPipelineRegistered,
  SUGGESTION_EMISSION_PHASE,
  SUGGESTION_REFRESH_KIND,
  SUGGESTION_TRANSLATION_PHASE,
  suggestionRefreshSchema,
  SUGGESTIONS_UNUSABLE,
  type SuggestionRefreshInput,
} from './definitions/suggestion-refresh'
export { __resetRegistry, getPipeline, registerPipeline } from './authoring/registry'
export { __resetBus, pipelineEventBus } from './runtime/event-bus'
export {
  __resetDeltaActionPort,
  configureDeltaActionPort,
  type DeltaActionPort,
} from './runtime/action-port'
// awaitRunTerminal is deliberately absent: it moved to lib/stores/generation so
// lib/actions can await a terminal without importing the orchestrator.
export { runPipeline, type RunCtx, type RunCtxFor } from './runtime/orchestrator'
export { recoverInFlightRuns } from './runtime/recovery'
export type { RecoveredRun, RecoveryFailure, RecoveryReport } from './runtime/recovery'
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
