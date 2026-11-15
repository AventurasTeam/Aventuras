export type ExternalCell<T> = {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * A one-value external store for story harnesses that stand in for a real store, read through
 * `useSyncExternalStore`. Not `useState`: a write inside a handler must be visible to a re-read
 * in the same turn, as the real store's is (a save session's post-commit re-read; see
 * docs/implementation/lessons-learned/save-session-harness-sync-refresh.md).
 */
export function externalCell<T>(initial: T): ExternalCell<T> {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (next) => {
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
