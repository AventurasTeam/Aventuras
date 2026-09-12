import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { Entity } from '@/lib/db'

type EntityTier = Entity['status']

// Session-scoped, never persisted (patterns/entity.md → Accordion grouping on
// "All" view): the working tier starts open, the rest closed.
const DEFAULT_COLLAPSED: ReadonlySet<EntityTier> = new Set<EntityTier>(['staged', 'retired'])

type WorldListState = {
  collapsed: ReadonlySet<EntityTier>
  setCollapsed: (tier: EntityTier, collapsed: boolean) => void
  __reset: () => void
}

const store = createStore<WorldListState>()((set) => ({
  collapsed: DEFAULT_COLLAPSED,
  setCollapsed: (tier, collapsed) =>
    set((s) => {
      if (s.collapsed.has(tier) === collapsed) return s
      const next = new Set(s.collapsed)
      if (collapsed) next.add(tier)
      else next.delete(tier)
      return { collapsed: next }
    }),
  __reset: () => set({ collapsed: DEFAULT_COLLAPSED }),
}))

const api = store.getState()

export const worldListStore = {
  useCollapsedTiers: (): ReadonlySet<EntityTier> => useStore(store, (s) => s.collapsed),
  getCollapsedTiers: (): ReadonlySet<EntityTier> => store.getState().collapsed,
  setCollapsed: api.setCollapsed,
  __reset: api.__reset,
}
