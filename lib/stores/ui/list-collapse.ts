import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

// Session-scoped, never persisted (patterns/entity.md → Accordion grouping). Keyed per kind:
// collapsing Staged on Characters must not affect Locations; `active` is both a tier and status.
type ListCollapseState = {
  byKind: ReadonlyMap<string, ReadonlySet<string>>
  setCollapsed: (
    kind: string,
    key: string,
    collapsed: boolean,
    defaults: ReadonlySet<string>,
  ) => void
  __reset: () => void
}

const store = createStore<ListCollapseState>()((set) => ({
  byKind: new Map(),
  setCollapsed: (kind, key, collapsed, defaults) =>
    set((s) => {
      const current = s.byKind.get(kind) ?? defaults
      if (current.has(key) === collapsed) return s
      const next = new Set(current)
      if (collapsed) next.add(key)
      else next.delete(key)
      const byKind = new Map(s.byKind)
      byKind.set(kind, next)
      return { byKind }
    }),
  __reset: () => set({ byKind: new Map() }),
}))

const api = store.getState()

export const listCollapseStore = {
  /** `defaults` must be a stable module-level set: it is returned as-is until the kind changes. */
  useCollapsed: (kind: string, defaults: ReadonlySet<string>): ReadonlySet<string> =>
    useStore(store, (s) => s.byKind.get(kind) ?? defaults),
  getCollapsed: (kind: string, defaults: ReadonlySet<string>): ReadonlySet<string> =>
    store.getState().byKind.get(kind) ?? defaults,
  setCollapsed: api.setCollapsed,
  __reset: api.__reset,
}
