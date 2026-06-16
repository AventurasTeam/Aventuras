import type { PipelineAction } from '@/lib/actions'
import type { ResolveFailureKind, ResolveTarget } from '@/lib/ai'
import type { StorySettings } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
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
      detail: string
      failure: ResolveFailureKind
      target: ResolveTarget
      phaseName: string
    }

export type PhaseResult =
  | { status: 'completed' }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError }

export type PhaseEmittedEvent =
  | { type: 'stream_chunk'; targetEntryId: string; text: string }
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

export type PhaseContext = {
  actionId: string
  abortSignal: AbortSignal
  intermediates: Record<string, unknown>
  // Run-bound logger so a phase's logs are turn-attributed without a global.
  log: Logger
}

export type PhaseFn = (ctx: PhaseContext) => AsyncGenerator<PhaseEmittedEvent, PhaseResult>

// Read-only snapshot the pre-flight walk validates against. M2 populates only
// `appSettings`; `storySettings` is reserved for M3 conditional predicates
// (e.g. "suggestions iff enabled") and stays unset until story-settings
// hydration reaches the orchestrator (2.7+).
export type PreflightSnapshot = {
  appSettings: AppSettingsSnapshot
  storySettings?: StorySettings
}

// A resolver input a phase declares. `narrative` is just a ResolveTarget, so the
// pseudo-slot needs no special casing. `when` gates the input on run-time config
// (M3 conditional phases); absent means always validated.
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

export type Pipeline = {
  kind: string
  phases: readonly PhaseNode[]
  affordance: 'invisible' | 'pill-only' | 'pill-and-banner'
  gateBehavior: 'hard-gate' | 'no-gate'
  concurrencyPolicy: ConcurrencyPolicy
  chainsTo?: (run: RunState) => string | null
}

export type TxResult = {
  runId: string
  actionId: string
  outcome: 'completed' | 'aborted' | 'failed'
  error?: PipelineError
}

// A start blocked by the concurrency contract produces no run (no runId/actionId).
export type RejectedStart = { outcome: 'rejected'; blockedBy: string }
