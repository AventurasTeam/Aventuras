/**
 * Creates a debounced save pair — `trigger()` and `flush()` — backed by a
 * single shared timer.
 *
 * - `trigger()` resets the timer on every call and fires `saveFn` once the
 *   delay has elapsed with no further calls.
 * - `flush()` cancels any pending timer and runs `saveFn` immediately (useful
 *   in `onDestroy` or before navigating away).
 *
 * @param saveFn  The function to call (may be async; errors are not caught).
 * @param delay   Debounce window in milliseconds (default: 500).
 */
export function createDebouncedSave(
  saveFn: () => void,
  delay = 500,
): { trigger: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  function trigger() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveFn()
    }, delay)
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
      saveFn()
    }
  }

  return { trigger, flush }
}
