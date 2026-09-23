export type ExternalCell<T> = {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * A one-value external store for save-session story harnesses, read through
 * `useSyncExternalStore`. Not `useState`: a write inside `onCommit` must be visible to the
 * provider's post-commit re-read, as the real store's is — see
 * docs/implementation/lessons-learned/save-session-harness-sync-refresh.md.
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
