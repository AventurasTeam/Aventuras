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

/**
 * Returns `true` when the app is running as a Tauri Android application.
 * Combines the user-agent check with a Tauri runtime probe.
 */
export function isTauriAndroid(): boolean {
  if (!isAndroid()) return false
  // window.__TAURI_INTERNALS__ is set by the Tauri runtime
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
}
