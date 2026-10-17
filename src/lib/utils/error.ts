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
