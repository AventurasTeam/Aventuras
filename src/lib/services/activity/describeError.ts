/**
 * Activity Error Reasons
 *
 * The text a failed step carries. Built once here so every layer that closes a step as failed
 * words the same error the same way.
 */

import { APICallError, RetryError } from 'ai'
import { errMessage } from '$lib/utils/error'

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

/** A cancellation -- Stop, or a timeout -- rather than a failure of the work. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** The reason to show for a failed step. A cancellation is not a failure: check `isAbortError`. */
export function describeActivityError(error: unknown): string {
  return cap(describe(error))
}

function describe(error: unknown): string {
  // The cause is repeated here: a request reported without attempt rows has nowhere else to show it.
  if (RetryError.isInstance(error)) {
    const attempts = attemptNumberOf(error.lastError) ?? error.errors.length
    const ran = error.reason === 'maxRetriesExceeded' ? ', with no retries left' : ''
    return `Failed after ${attempts} attempts${ran}: ${reasonOf(error.lastError)}`
  }
  const attempt = attemptNumberOf(error)
  if (attempt && attempt > 1) return `${reasonOf(error)} (on attempt ${attempt})`
  return reasonOf(error)
}

/**
 * How the HTTP plugin reports any failure reading a response body, its cause dropped. Almost always
 * a connection lost mid-stream; rarely a body that would not decompress.
 */
const BODY_READ_FAILURE = 'error decoding response body'

const CONNECTION_LOST = 'Connection lost while the response was streaming'

function reasonOf(error: unknown): string {
  const reason = messageOf(error)
  return reason.includes(BODY_READ_FAILURE) && !reason.includes(CONNECTION_LOST)
    ? `${CONNECTION_LOST} (${reason})`
    : reason
}

function messageOf(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const message = providerMessage(error.responseBody) ?? error.message
    return error.statusCode ? `${error.statusCode} · ${message}` : message
  }
  return errMessage(error)
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
