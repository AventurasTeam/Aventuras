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
 * Returns `true` when the primary input can hover, i.e. when a `title` tooltip can
 * actually explain a control. This is a capability, not a screen size: a desktop window
 * dragged narrow still hovers, a tablet at 1024px never does.
 */
export function supportsHover(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof window.matchMedia !== 'function') return !isAndroid()
  return !window.matchMedia('(hover: none)').matches
}

/** No-op off Android. Asks the WebView's keyboard not to learn from what is typed. */
export function applyIncognitoKeyboard(enabled: boolean): void {
  if (!isAndroid()) return
  try {
    window.AndroidBridge?.setIncognitoKeyboard(enabled)
  } catch (e) {
    console.warn('[platform] Failed to set incognito keyboard:', e)
  }
}
