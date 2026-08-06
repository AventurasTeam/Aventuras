// AbortSignal.timeout / .any are statics Hermes has historically lacked, so
// this composes the same behavior from AbortController + setTimeout, matching
// lib/embedder/download/model-card.ts.
export function boundedSignal(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; expired: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, ms)
  // Clears the timer, not just relays: left armed it can still fire while the
  // aborted call winds down, and `expired` is what tells a cancel from a
  // timeout — a late fire would burn a retry on a clean cancellation.
  const relay = () => {
    clearTimeout(timer)
    controller.abort()
  }
  if (outer?.aborted) relay()
  else outer?.addEventListener('abort', relay)
  return {
    signal: controller.signal,
    /** Stays readable after dispose: the flag is captured, not derived. */
    expired: () => expired,
    dispose: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', relay)
    },
  }
}
