import {
  describeContextWindow,
  describeReplyCutOff,
  type CallRetryError,
  type ResolveTarget,
} from '@/lib/ai'

import type { PipelineError } from './types'

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
