/**
 * Creates a debounced save pair — `trigger()` and `flush()` — backed by a
 * single shared timer.
 *
 * - `trigger()` resets the timer on every call and fires `saveFn` once the
 *   delay has elapsed with no further calls.
 * - `flush()` cancels any pending timer and runs `saveFn` immediately (useful
 *   in `onDestroy` or before navigating away).
 *
 * Errors thrown synchronously or via a rejected Promise from `saveFn` are
 * logged to `console.error` so fire-and-forget callers (e.g. `onDestroy`)
 * don't produce unhandled rejections. Callers that need UI-level error
 * handling should do it inside their own `saveFn`.
 *
 * @param saveFn  The function to call on debounce fire or flush.
 * @param delay   Debounce window in milliseconds (default: 500).
 */
export function createDebouncedSave(
  saveFn: () => void | Promise<void>,
  delay = 500,
): { trigger: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  function safeSave() {
    try {
      const result = saveFn()
      if (result instanceof Promise) {
        result.catch((err) => console.error('Debounced save failed:', err))
      }
    } catch (err) {
      console.error('Debounced save failed:', err)
    }
  }

  function trigger() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      safeSave()
    }, delay)
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
      safeSave()
    }
  }

  return { trigger, flush }
}
