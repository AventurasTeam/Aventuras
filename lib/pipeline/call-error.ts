import {
  describeCallRetryError,
  describeContextWindow,
  describeReplyCutOff,
  type CallRetryError,
  type GenerateStructuredResult,
  type ResolveTarget,
} from '@/lib/ai'

import type { PhaseEmittedEvent, PipelineError } from './types'

// CallRetryError is lib/ai's vocabulary; the pipeline maps it to PipelineError
// when it surfaces recoverable_error / fatal events (generation-pipeline.md →
// Two retry tiers). lib/ai stays free of an upward PipelineError dependency.
export function toPipelineError(e: CallRetryError, target: ResolveTarget): PipelineError {
  switch (e.tier) {
    case 'provider':
      return {
        kind: 'provider',
        reason: e.reason,
        ...(e.detail !== undefined ? { detail: e.detail } : {}),
        ...(e.possibleCapabilityMismatch !== undefined
          ? { possibleCapabilityMismatch: e.possibleCapabilityMismatch }
          : {}),
      }
    case 'parse':
      return { kind: 'phase-logic', detail: e.detail }
    case 'context-window': {
      const { tier: _tier, ...failure } = e
      return { kind: 'context-window', target, ...failure }
    }
    case 'reply-cut-off': {
      const { tier: _tier, ...failure } = e
      return { kind: 'reply-cut-off', target, ...failure }
    }
  }
}

export type StructuredCallFailure = Exclude<GenerateStructuredResult<unknown>, { status: 'ok' }>

/**
 * A structured call that didn't return a value, as the run's error. `lastError` keeps the bare
 * cause for a status block; the error is what the reader shows.
 */
export function structuredCallFailure(
  result: StructuredCallFailure,
  call: { target: ResolveTarget; phaseName: string; timeoutMs: number },
): { lastError: string; error: PipelineError } {
  switch (result.status) {
    // Only an expiry reaches here: the caller returns a cancel as an aborted phase first.
    case 'aborted':
      return {
        lastError: `timeout after ${call.timeoutMs}ms`,
        error: {
          kind: 'provider',
          reason: 'timeout',
          detail: `${call.target}: timeout after ${call.timeoutMs}ms`,
        },
      }
    // A config fault, so the reader's entry can offer its fix.
    case 'not-configured':
      return {
        lastError: result.kind,
        error: {
          kind: 'config-resolver',
          failure: result.kind,
          target: call.target,
          phaseName: call.phaseName,
        },
      }
    // A cut reply fails as reply-cut-off, so the reader's entry can name the limit.
    case 'failed':
      return {
        lastError: describeCallRetryError(result.error),
        error: toPipelineError(result.error, call.target),
      }
  }
}

/** generation-pipeline.md → Two retry tiers: one event per retried attempt, however the call ended. */
export function* retriedAttemptEvents(
  result: { recoverable: readonly CallRetryError[] } | { status: 'not-configured' },
  target: ResolveTarget,
): Generator<PhaseEmittedEvent, void> {
  if (!('recoverable' in result)) return
  for (const attempt of result.recoverable)
    yield { type: 'recoverable_error', error: toPipelineError(attempt, target) }
}

/** Log and status detail: the arm's own (may span lines), or the window or cut-off described. */
export function pipelineErrorDetail(e: PipelineError): string | undefined {
  switch (e.kind) {
    case 'context-window':
      return describeContextWindow(e)
    case 'reply-cut-off':
      return describeReplyCutOff(e)
    case 'provider':
    case 'phase-logic':
    case 'action-layer':
    case 'orchestrator':
    case 'config-resolver':
    case 'embedder':
      return e.detail
    default: {
      const _exhaustive: never = e
      return _exhaustive
    }
  }
}
