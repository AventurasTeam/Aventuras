// Hermes lacks AbortSignal.timeout / .any, so this composes them from
// AbortController + setTimeout, matching lib/embedder/download/model-card.ts.
// The reason is how a consumer holding only the signal tells an expiry from a stop.
export const BOUNDED_SIGNAL_EXPIRED = 'bounded-signal-expired'

export type AbortCause = 'stop' | 'timeout'

/**
 * Which of the two reasons aborted `signal`. Centralised because
 * `AbortSignal.reason` is typed `any`: an inline compare typechecks against anything.
 */
export function abortCauseOf(signal: AbortSignal): AbortCause {
  return signal.reason === BOUNDED_SIGNAL_EXPIRED ? 'timeout' : 'stop'
}

export function boundedSignal(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; expired: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    controller.abort(BOUNDED_SIGNAL_EXPIRED)
  }, ms)
  // Clears the timer, not just relays: left armed it can still fire while the
  // aborted call winds down, and `expired` is what tells a cancel from a
  // timeout — a late fire would burn a retry on a clean cancellation.
  const relay = () => {
    clearTimeout(timer)
    controller.abort(outer?.reason)
  }
  if (outer?.aborted) relay()
  else outer?.addEventListener('abort', relay)
  return {
    signal: controller.signal,
    /**
     * Captured, not derived, so it stays readable after dispose. Always agrees
     * with `abortCauseOf(signal)`: each path sets or clears before it aborts.
     */
    expired: () => expired,
    dispose: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', relay)
    },
  }
}
