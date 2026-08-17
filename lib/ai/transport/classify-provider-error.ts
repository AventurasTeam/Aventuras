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

const MAX_CAUSE_DEPTH = 5

function labelOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  // The AI SDK stamps every error name with an `AI_` prefix; it carries no
  // information the surrounding log line doesn't already have.
  const name = error.name.replace(/^AI_/, '')
  const { message } = error
  if (message.length === 0) return name
  return name.length > 0 && name !== 'Error' && !message.startsWith(name)
    ? `${name}: ${message}`
    : message
}

/**
 * Flattens an error's `cause` chain into one line, root-most link last.
 *
 * The AI SDK wraps anything its response handler throws in an `APICallError`
 * whose own message names only the envelope ("Failed to process successful
 * response"); the actual failure — empty body, schema mismatch — is a `cause`
 * link down. A bare `.message` therefore reports nothing actionable.
 */
export function describeProviderError(error: unknown): string {
  const links: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    const label = labelOf(current)
    if (links.at(-1) !== label) links.push(label)
    current = current instanceof Error ? current.cause : undefined
  }
  return links.join(' ← ')
}

function parseRetryAfter(headers: Record<string, string> | undefined): number | undefined {
  if (headers === undefined) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after')
  const raw = key ? headers[key] : undefined
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

export function classifyProviderError(error: unknown): {
  error: Extract<CallRetryError, { tier: 'provider' }>
  retryable: boolean
  retryAfterMs?: number
} {
  if (error instanceof ProviderTimeoutError) {
    return { error: { tier: 'provider', reason: 'timeout' }, retryable: true }
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const retryAfterMs = parseRetryAfter(error.responseHeaders)
    if (status === 401 || status === 403) {
      return {
        error: { tier: 'provider', reason: 'auth', detail: describeProviderError(error) },
        retryable: false,
      }
    }
    if (status === 429) {
      return {
        error: { tier: 'provider', reason: 'network', detail: describeProviderError(error) },
        retryable: true,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      }
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return {
        error: { tier: 'provider', reason: 'unknown', detail: describeProviderError(error) },
        retryable: false,
      }
    }
    return {
      error: { tier: 'provider', reason: 'network', detail: describeProviderError(error) },
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    }
  }
  return {
    error: {
      tier: 'provider',
      reason: 'unknown',
      detail: describeProviderError(error),
    },
    retryable: true,
  }
}
