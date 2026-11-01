/** An HTTP helper's own timer expired. Not named `TimeoutError`: the AI SDK treats that as an abort. */
export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError'
  constructor(
    readonly timeoutMs: number,
    what = 'Request',
  ) {
    super(`${what} timed out after ${timeoutMs / 1000}s`)
  }
}

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Tauri command rejections arrive as plain strings, not `Error` objects, so the common
 * `e instanceof Error ? e.message : 'Unknown error'` throws away the real (often precise)
 * message from Rust. This helper preserves it: strings pass through, Errors yield `.message`,
 * objects with a `message` field use it, and anything else is stringified.
 */
export function errMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  try {
    // `undefined` and functions stringify to undefined, not to a string.
    return JSON.stringify(e) ?? String(e)
  } catch {
    return String(e)
  }
}

/** The first non-blank line of `text`, cut to `max` characters. */
export function errorSummary(text: string, max = 200): string {
  const first = text.split('\n').find((line) => line.trim()) ?? ''
  const line = first.trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** A response that was not a success, with the status and body it came back with. */
export class HttpStatusError extends Error {
  override name = 'HttpStatusError'
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} error ${status}: ${body}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The message field of a provider's JSON error body, in the shapes providers actually use. */
export function providerMessage(body: string | undefined): string | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { error, message, detail } = parsed
  if (isRecord(error) && typeof error.message === 'string') return error.message
  for (const candidate of [error, message, detail]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return null
}
