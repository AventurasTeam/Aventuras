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
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
