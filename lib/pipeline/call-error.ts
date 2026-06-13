import type { CallRetryError } from '@/lib/ai'

import type { PipelineError } from './types'

// CallRetryError is lib/ai's vocabulary; the pipeline maps it to PipelineError
// when it surfaces recoverable_error / fatal events (generation-pipeline.md →
// Two retry tiers). lib/ai stays free of an upward PipelineError dependency.
export function toPipelineError(e: CallRetryError): PipelineError {
  return e.tier === 'provider'
    ? {
        kind: 'provider',
        reason: e.reason,
        ...(e.detail !== undefined ? { detail: e.detail } : {}),
      }
    : { kind: 'phase-logic', detail: e.detail }
}
