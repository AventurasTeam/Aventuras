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
 * Returns `true` when running inside an iOS WebView (user-agent based). iPadOS 13+
 * defaulting to a desktop UA in Safari is not a concern here: inside a WKWebView the
 * app's own UA always matches.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
}

/**
 * Returns `true` when hovering can be relied on: the primary input hovers and no input is a
 * finger, so a `title` tooltip can actually explain a control. A capability, not a screen
 * size: a desktop window dragged narrow still hovers, a tablet or a touchscreen laptop never
 * does. The same condition as the `can-hover` variant in `app.css`; change both together.
 */
export function supportsHover(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof window.matchMedia !== 'function') return !isAndroid()
  return (
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(any-pointer: coarse)').matches
  )
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
