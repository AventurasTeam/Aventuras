/**
 * Type declarations for the Android JavaScript bridge.
 *
 * The `AndroidBridge` object is injected into the WebView by
 * {@link MainActivity.kt} via `addJavascriptInterface()`.
 * It is only available when the app runs on Android.
 */

export interface AndroidBridge {
  /** Start the foreground service that keeps the process alive during generation. */
  startGenerationService(): void
  /** Stop the foreground service after generation completes / fails / is aborted. */
  stopGenerationService(): void
}

declare global {
  interface Window {
    /**
     * Bridge object injected by the Android host activity.
     * `undefined` on non-Android platforms.
     */
    AndroidBridge?: AndroidBridge
  }
}
