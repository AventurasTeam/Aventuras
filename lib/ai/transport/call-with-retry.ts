import { ContextWindowError } from '../context-window'
import { ReplyCutOffError } from '../reply-cut-off'
import { type CallRetryError, classifyProviderError } from './classify-provider-error'

// Re-export so consumers can treat CallRetryError as the retry helper's vocabulary.
export type { CallRetryError } from './classify-provider-error'

const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 30_000

function exponentialBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1))
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<'elapsed' | 'aborted'> {
  if (signal.aborted) return Promise.resolve('aborted')
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve('aborted')
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve('elapsed')
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export type CallWithRetryResult<T> =
  | { status: 'ok'; result: T; recoverable: readonly CallRetryError[] }
  | { status: 'failed'; error: CallRetryError; recoverable: readonly CallRetryError[] }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

type CallWithRetryOpts = {
  maxProviderAttempts: number
  maxParseAttempts: number
  signal: AbortSignal
}

// Two-tier retry: provider (network/5xx/timeout) and parse/data-shape. Retried failures
// go in recoverable[]; the one exhausting a budget (or non-retryable) is the terminal
// `error`. Aborts short-circuit, as do a callFn ContextWindowError and a parseFn
// ReplyCutOffError (each would recur).
export async function callWithRetry<T, R = string>(
  callFn: (signal: AbortSignal) => Promise<R>,
  parseFn: (raw: R) => T,
  opts: CallWithRetryOpts,
): Promise<CallWithRetryResult<T>> {
  const recoverable: CallRetryError[] = []
  let providerAttempt = 0
  let parseAttempt = 0

  for (;;) {
    if (opts.signal.aborted) return { status: 'aborted', recoverable }

    let raw: R
    try {
      raw = await callFn(opts.signal)
    } catch (e) {
      if (opts.signal.aborted) return { status: 'aborted', recoverable }
      if (e instanceof ContextWindowError) {
        return { status: 'failed', error: { tier: 'context-window', ...e.failure }, recoverable }
      }
      const classified = classifyProviderError(e)
      providerAttempt += 1
      if (!classified.retryable || providerAttempt >= opts.maxProviderAttempts) {
        return { status: 'failed', error: classified.error, recoverable }
      }
      recoverable.push(classified.error)
      const backoffMs = Math.min(
        BACKOFF_CAP_MS,
        classified.retryAfterMs ?? exponentialBackoffMs(providerAttempt),
      )
      if ((await abortableDelay(backoffMs, opts.signal)) === 'aborted') {
        return { status: 'aborted', recoverable }
      }
      continue
    }

    try {
      return { status: 'ok', result: parseFn(raw), recoverable }
    } catch (e) {
      if (e instanceof ReplyCutOffError) {
        return { status: 'failed', error: { tier: 'reply-cut-off', ...e.failure }, recoverable }
      }
      const parseError: CallRetryError = {
        tier: 'parse',
        detail: e instanceof Error ? e.message : String(e),
        attempt: parseAttempt,
      }
      parseAttempt += 1
      if (parseAttempt >= opts.maxParseAttempts) {
        return { status: 'failed', error: parseError, recoverable }
      }
      recoverable.push(parseError)
      continue
    }
  }
}
