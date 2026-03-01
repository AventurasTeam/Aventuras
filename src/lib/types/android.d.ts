/**
 * Type declarations for the Android JavaScript bridge.
 *
 * The `AndroidBridge` object is injected into the WebView by
 * {@link MainActivity.kt} via `addJavascriptInterface()`.
 * It is only available when the app runs on Android.
 *
 * This is an ambient declaration file — no imports/exports at the top level
 * so TypeScript picks it up automatically via tsconfig includes.
 */

interface AndroidBridge {
  /** Start the foreground service that keeps the process alive during generation. */
  startGenerationService(): void
  /** Stop the foreground service after generation completes / fails / is aborted. */
  stopGenerationService(): void
}

interface Window {
  /**
   * Bridge object injected by the Android host activity.
   * `undefined` on non-Android platforms.
   */
  AndroidBridge?: AndroidBridge
}
