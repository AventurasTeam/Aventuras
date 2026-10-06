// React Native installs abort-controller@3 as the global AbortController (setUpXHR.js): it has
// no AbortSignal.timeout / .any, and its abort() drops the reason. So this composes the bounded
// signal by hand, and records the cause beside the signal rather than in `signal.reason`.
const BOUNDED_SIGNAL_EXPIRED = 'bounded-signal-expired'

export type AbortCause = 'stop' | 'timeout'

const causes = new WeakMap<AbortSignal, AbortCause>()

/** Which of the two causes aborted `signal`, as recorded by `boundedSignal`. */
export function abortCauseOf(signal: AbortSignal): AbortCause {
  return causes.get(signal) ?? 'stop'
}

export function boundedSignal(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; expired: () => boolean; dispose: () => void } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    causes.set(controller.signal, 'timeout')
    controller.abort(BOUNDED_SIGNAL_EXPIRED)
  }, ms)
  // Clears the timer, not just relays: left armed it can still fire while the
  // aborted call winds down, and `expired` is what tells a cancel from a
  // timeout — a late fire would burn a retry on a clean cancellation.
  const relay = () => {
    clearTimeout(timer)
    if (outer) causes.set(controller.signal, abortCauseOf(outer))
    controller.abort(outer?.reason)
  }
  if (outer?.aborted) relay()
  else outer?.addEventListener('abort', relay)
  return {
    signal: controller.signal,
    /**
     * Captured, not derived, so it stays readable after dispose. This signal's own timer
     * only: `abortCauseOf` also reads an expiry relayed from `outer` as a timeout.
     */
    expired: () => expired,
    dispose: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', relay)
    },
  }
}
