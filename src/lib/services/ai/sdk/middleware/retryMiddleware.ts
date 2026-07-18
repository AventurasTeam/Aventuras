import type { LanguageModelV3Middleware } from '@ai-sdk/provider'
import { settings } from '$lib/stores/settings.svelte'

const RETRY_DELAYS_MS = [10_000, 20_000, 30_000]
const JITTER_FACTOR = 0.1

function withJitter(ms: number): number {
  return ms * (1 + (Math.random() * 2 - 1) * JITTER_FACTOR)
}

/**
 * Abort-aware sleep. Resolves after `ms`, or rejects with the signal's reason
 * if the caller cancels the generation mid-backoff. Without this, a 10–30s
 * sleep would block cancellation until the delay elapses.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function is429(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'statusCode' in error &&
    (error as { statusCode: number }).statusCode === 429
  )
}

/**
 * Parse `Retry-After` (delta-seconds or HTTP-date) from an AI SDK error's
 * responseHeaders. Returns null if missing or unparseable.
 */
function parseRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const headers = (error as { responseHeaders?: Record<string, string> }).responseHeaders
  if (!headers) return null
  const raw = headers['retry-after'] ?? headers['Retry-After']
  if (!raw) return null

  const seconds = Number(raw)
  if (Number.isFinite(seconds)) {
    const ms = seconds * 1000
    return ms > 0 ? ms : null
  }

  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) {
    const ms = dateMs - Date.now()
    return ms > 0 ? ms : null
  }

  return null
}

async function withRetry<T>(fn: () => PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!is429(error)) throw error
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.warn(
          `[retryMiddleware] gave up after ${RETRY_DELAYS_MS.length} retries on 429, propagating error`,
        )
        throw error
      }

      const retryAfterMs = parseRetryAfterMs(error)
      const maxRetryAfterMs = settings.apiSettings.llmTimeoutMs
      if (retryAfterMs !== null && retryAfterMs > maxRetryAfterMs) {
        console.warn(
          `[retryMiddleware] 429 with Retry-After=${Math.round(retryAfterMs / 1000)}s exceeds timeout cap (${maxRetryAfterMs / 1000}s), failing fast`,
        )
        throw error
      }

      lastError = error
      // Jitter only the default backoff to spread reconnections (anti-thundering-
      // herd). Server-provided Retry-After is a floor — subtracting jitter would
      // retry before the server is ready and earn another 429.
      const base = retryAfterMs ?? RETRY_DELAYS_MS[attempt]
      const delay = retryAfterMs !== null ? base : withJitter(base)
      const src = retryAfterMs !== null ? 'Retry-After' : 'backoff'
      console.warn(
        `[retryMiddleware] 429 received, retrying in ${Math.round(delay / 1000)}s (${src}, attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
      )
      await sleep(delay, signal)
    }
  }
  throw lastError
}

// Note: wrapStream only retries 429s surfaced as a rejected `doStream()` promise
// (i.e. pre-stream, on the initial HTTP response headers). A 429 emitted as an
// error event *after* the stream has started is not caught here — rare on
// OpenAI-compatible providers, but not impossible.
export const retryOn429Middleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate, params }) => withRetry(() => doGenerate(), params.abortSignal),
  wrapStream: async ({ doStream, params }) => withRetry(() => doStream(), params.abortSignal),
}
