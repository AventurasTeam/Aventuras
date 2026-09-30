/**
 * Activity Error Reasons
 *
 * The text a failed step carries. Built once here so every layer that closes a step as failed
 * words the same error the same way.
 */

import { APICallError, RetryError } from 'ai'

/** A reason is shown in full, but a provider can echo a whole prompt back in its error body. */
const MAX_REASON_LENGTH = 300

/**
 * Set on an attempt's error by whoever counts a request's attempts: how many it had made when this
 * one failed. The SDK's own count misses the app's retries inside each of its attempts.
 */
export const ATTEMPT_NUMBER = Symbol.for('aventuras.activity.attemptNumber')

const attemptNumberOf = (error: unknown): number | undefined =>
  error !== null && typeof error === 'object'
    ? ((error as Record<symbol, unknown>)[ATTEMPT_NUMBER] as number | undefined)
    : undefined

/** The reason to show for `error`, or null for an abort, which closes a step as skipped. */
export function describeActivityError(error: unknown): string | null {
  if (error instanceof Error && error.name === 'AbortError') return null
  return cap(describe(error))
}

function describe(error: unknown): string {
  // Each attempt carries its own reason on its own row; the request says only that it ran out.
  if (RetryError.isInstance(error)) {
    const attempts = attemptNumberOf(error.lastError) ?? error.errors.length
    return `Failed after ${attempts} attempts, with no retries left`
  }
  const attempt = attemptNumberOf(error)
  if (attempt && attempt > 1) return `${reasonOf(error)} (on attempt ${attempt})`
  return reasonOf(error)
}

function reasonOf(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const message = providerMessage(error.responseBody) ?? error.message
    return error.statusCode ? `${error.statusCode} · ${message}` : message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/** The message field of a provider's JSON error body, in the shapes providers actually use. */
function providerMessage(body: string | undefined): string | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { error, message, detail } = parsed as Record<string, unknown>
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return (error as any).message
  }
  for (const candidate of [error, message, detail]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return null
}

function cap(text: string): string {
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH - 1)}…` : text
}
