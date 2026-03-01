/**
 * Platform detection utilities.
 *
 * Provides lightweight checks for determining the runtime platform,
 * primarily used to guard Android-specific features like the
 * background-generation foreground service.
 */

/** Returns `true` when running inside an Android WebView (user-agent based). */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}
