import { APICallError } from 'ai'

// lib/ai-local error vocabulary. The pipeline layer maps these to PipelineError
// when it yields recoverable_error events — keeps lib/ai free of an upward
// lib/pipeline type dependency.
export type CallRetryError =
  | { tier: 'provider'; reason: 'auth' | 'network' | 'timeout' | 'unknown'; detail?: string }
  | { tier: 'parse'; detail: string; attempt: number }

// Thrown by a callFn when its own per-attempt timeout fires (so callWithRetry
// classifies it as a retryable provider timeout, not a user-cancel abort).
export class ProviderTimeoutError extends Error {
  constructor(message = 'provider call timed out') {
    super(message)
    this.name = 'ProviderTimeoutError'
  }
}

export function classifyProviderError(error: unknown): {
  error: Extract<CallRetryError, { tier: 'provider' }>
  retryable: boolean
} {
  if (error instanceof ProviderTimeoutError) {
    return { error: { tier: 'provider', reason: 'timeout' }, retryable: true }
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    if (status === 401 || status === 403) {
      return {
        error: { tier: 'provider', reason: 'auth', detail: error.message },
        retryable: false,
      }
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return {
        error: { tier: 'provider', reason: 'unknown', detail: error.message },
        retryable: false,
      }
    }
    return {
      error: { tier: 'provider', reason: 'network', detail: error.message },
      retryable: true,
    }
  }
  return {
    error: {
      tier: 'provider',
      reason: 'unknown',
      detail: error instanceof Error ? error.message : String(error),
    },
    retryable: true,
  }
}
