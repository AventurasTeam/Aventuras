export { runPipeline, type RunCtx } from './runtime/orchestrator'
export { definePipeline, definePhase } from './authoring/define'
export { registerPipeline, getPipeline, __resetRegistry } from './authoring/registry'
export { pipelineEventBus, __resetBus } from './runtime/event-bus'
export { isUserEditBlocked } from './runtime/gate'
// Re-export the ambient reader for pipeline-centric callers (delegates to the
// lib/diagnostics slot — set/cleared by the orchestrator).
export { getCurrentActionId } from '@/lib/diagnostics'
export { recoverInFlightRuns } from './runtime/recovery'
export type { RecoveredRun, RecoveryFailure, RecoveryReport } from './runtime/recovery'
export type {
  ConcurrencyPolicy,
  PhaseEmittedEvent,
  PhaseFn,
  PhaseNode,
  PhaseResult,
  Pipeline,
  PipelineError,
  PipelineEvent,
  TxResult,
} from './types'
