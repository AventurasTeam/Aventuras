/** `onerror` for the boundary around an activity report, which renders no fallback. */
export function reportRenderError(error: unknown): void {
  console.warn('[activity] Report failed to render:', error)
}
