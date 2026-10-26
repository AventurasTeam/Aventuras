import { describeReplyCutOff, type CallRetryError, type ResolveTarget } from '@/lib/ai'

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
      }
    case 'parse':
      return { kind: 'phase-logic', detail: e.detail }
    case 'reply-cut-off': {
      const { tier: _tier, ...failure } = e
      return { kind: 'reply-cut-off', target, ...failure }
    }
  }
}

/** A failure's one-line detail for logs and status: the arm's own, or the cut-off described. */
export function pipelineErrorDetail(e: PipelineError): string | undefined {
  return e.kind === 'reply-cut-off' ? describeReplyCutOff(e) : e.detail
}
