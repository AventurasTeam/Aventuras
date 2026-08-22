import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * The overlays currently claiming the surface — bottom sheets and modal
 * dialogs — held as opaque per-instance tokens.
 *
 * A set rather than a counter: a duplicate release is a no-op instead of
 * underflowing the gate into permanently-unblocked, which fails open silently.
 */
type BlockingOverlaysState = { open: ReadonlySet<object> }

const store = createStore<BlockingOverlaysState>()(() => ({ open: new Set<object>() }))

export const blockingOverlaysStore = {
  useBlockingOverlayCount: (): number => useStore(store, (s) => s.open.size),
  getState: (): BlockingOverlaysState => store.getState(),
  acquire: (token: object): void =>
    store.setState((s) => {
      if (s.open.has(token)) return s
      const open = new Set(s.open)
      open.add(token)
      return { open }
    }),
  release: (token: object): void =>
    store.setState((s) => {
      if (!s.open.has(token)) return s
      const open = new Set(s.open)
      open.delete(token)
      return { open }
    }),
  __reset: (): void => store.setState({ open: new Set<object>() }),
}

export type { BlockingOverlaysState }
