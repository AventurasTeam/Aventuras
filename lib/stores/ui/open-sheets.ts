import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * The phone bottom sheets currently open, held as opaque per-instance tokens.
 *
 * A set rather than a counter: a duplicate release is a no-op instead of
 * underflowing the gate into permanently-unblocked, which fails open silently.
 */
type OpenSheetsState = { open: ReadonlySet<object> }

const store = createStore<OpenSheetsState>()(() => ({ open: new Set<object>() }))

export const openSheetsStore = {
  useOpenSheetCount: (): number => useStore(store, (s) => s.open.size),
  getState: (): OpenSheetsState => store.getState(),
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

export type { OpenSheetsState }
