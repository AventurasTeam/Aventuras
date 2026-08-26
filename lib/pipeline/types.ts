import type { PipelineAction } from '@/lib/actions/types'
import type { ResolveFailureKind, ResolveTarget } from '@/lib/ai'
import type { DbCtx, StorySettings } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import type { EmbedderErrorKind } from '@/lib/embedder'
import type { AppSettingsSnapshot, RunState } from '@/lib/stores'

export type PipelineError =
  | { kind: 'provider'; reason: 'auth' | 'network' | 'timeout' | 'unknown'; detail?: string }
  | { kind: 'phase-logic'; detail: string; phaseName?: string; subsystem?: string }
  | {
      kind: 'action-layer'
      detail: string
      tableName?: string
      targetId?: string
      constraintViolated?: string
    }
  | { kind: 'orchestrator'; detail: string }
  | {
      kind: 'config-resolver'
      failure: ResolveFailureKind
      target: ResolveTarget
      phaseName: string
      detail?: string
    }
  // The blocking pre-retrieval sync stage and the query embed beside it
  // (model-management.md → Embed failure is blocking). Distinct from 'provider',
  // whose retry story is the LLM's. `staleCount` is null when there is no
  // magnitude to report — see RetrievalFailure in lib/retrieval.
  | { kind: 'embedder'; reason: EmbedderErrorKind; detail: string; staleCount: number | null }

export type PhaseResult =
  | { status: 'completed' }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

export type PhaseEmittedEvent =
  | { type: 'stream_chunk'; targetEntryId: string; text: string; channel: 'text' | 'reasoning' }
  | { type: 'delta_emitted'; action: PipelineAction; entryId?: string | null }
  | { type: 'recoverable_error'; error: PipelineError }

export type PipelineEvent =
  | { type: 'run_start'; runId: string; kind: string; actionId: string }
  | {
      type: 'run_complete'
      runId: string
      kind: string
      actionId: string
      outcome: 'completed' | 'aborted' | 'failed'
      error?: PipelineError
    }
  | { type: 'phase_start'; runId: string; name: string }
  | { type: 'phase_complete'; runId: string; name: string; result: PhaseResult }
  | PhaseEmittedEvent

// Caller-supplied run parameters, keyed by kind. Only kinds that REQUIRE inputs
// appear here; any other kind (including the ad-hoc ones test harnesses
// register) keeps `inputs?: unknown`. Declared at the framework level rather
// than in each definition so `runPipeline` can correlate its two arguments —
// the call site is the one place an external module can get this wrong, and it
// used to fail at runtime as a 'phase-logic' error instead.
export type PipelineInputMap = {
  'suggestion-refresh': { refreshGuidance: string }
}

export type PhaseContext = {
  actionId: string
  abortSignal: AbortSignal
  intermediates: Record<string, unknown>
  // The run's caller-supplied parameters, distinct from `intermediates`
  // (phase-to-phase scratch) per generation-pipeline.md → Run-scoped state. Still
  // `unknown` on the phase side: the registry stores every kind's phases under one
  // type, so narrowing here needs a generic Pipeline. The phase re-validates.
  inputs?: unknown
  // Run-bound logger so a phase's logs are turn-attributed without a global.
  log: Logger
  // The run's db handle, so a phase can resolve tail positions (MAX(position)+1)
  // against committed rows rather than a possibly-gappy in-memory store.
  db: DbCtx['db']
  // The run's transaction runner. Only the retrieval phase writes outside the
  // delta log (its vec0 sync), and it takes the run's handle rather than the
  // module global so a test's db and its writes cannot diverge.
  runInTransaction: DbCtx['runInTransaction']
  // Run identity, so a per-turn phase can read the open story / branch stores
  // without the generationStore self-lookup the interim narrative phase used.
  storyId: string | null
  branchId: string
}

export type PhaseFn = (ctx: PhaseContext) => AsyncGenerator<PhaseEmittedEvent, PhaseResult>

export type PreflightSnapshot = {
  appSettings: AppSettingsSnapshot
  storySettings?: StorySettings
}

export type ResolverInput = {
  target: ResolveTarget
  when?: (snapshot: PreflightSnapshot) => boolean
}

export type PhaseNode =
  | { name: string; run: PhaseFn; resolves?: readonly ResolverInput[] }
  | {
      name: string
      parallel: readonly { name: string; run: PhaseFn; resolves?: readonly ResolverInput[] }[]
    }

export type ConcurrencyPolicy = { blockedBy?: readonly string[]; yieldsTo?: readonly string[] }

/**
 * Reacts to the pipeline's own pre-flight failure. Pre-flight halts before phase
 * 0, so a pipeline that keeps failure bookkeeping in a phase would never record
 * one. The orchestrator calls this while the run is still registered, which is
 * what puts the write under the same concurrency gate as the phases' writes — a
 * caller inspecting the returned result is already outside it.
 */
export type PreflightFailureHook = (
  ctx: Pick<PhaseContext, 'db' | 'branchId'>,
  error: PipelineError,
) => Promise<void>

export type Pipeline = {
  kind: string
  phases: readonly PhaseNode[]
  affordance: 'invisible' | 'pill-only' | 'pill-and-banner'
  gateBehavior: 'hard-gate' | 'no-gate'
  concurrencyPolicy: ConcurrencyPolicy
  chainsTo?: (run: RunState) => string | null
  onPreflightFailure?: PreflightFailureHook
}

export type TxResult = {
  runId: string
  actionId: string
  outcome: 'completed' | 'aborted' | 'failed'
  error?: PipelineError
}

// A start blocked by the concurrency contract produces no run (no runId/actionId).
export type RejectedStart = { outcome: 'rejected'; blockedBy: string }
