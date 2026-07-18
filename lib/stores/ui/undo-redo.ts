import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { RedoSnapshot } from '@/lib/actions'

// peek returns (and the selector sees) the live stack arrays — readonly so a
// caller can't splice store state in place.
type RedoGroup = readonly RedoSnapshot[]

type UndoRedoState = {
  redoStack: readonly RedoGroup[]
  pushRedoGroup: (group: RedoGroup) => void
  peekRedoGroup: () => RedoGroup | undefined
  popRedoGroup: () => RedoGroup | undefined
  clear: () => void
}

const store = createStore<UndoRedoState>()((set, get) => ({
  redoStack: [],
  pushRedoGroup: (group) => set((s) => ({ redoStack: [...s.redoStack, group] })),
  peekRedoGroup: () => get().redoStack.at(-1),
  popRedoGroup: () => {
    const stack = get().redoStack
    const top = stack.at(-1)
    if (top) set({ redoStack: stack.slice(0, -1) })
    return top
  },
  clear: () => set({ redoStack: [] }),
}))

const api = store.getState()

export const undoRedoStore = {
  useUndoRedo: <T>(selector: (s: UndoRedoState) => T): T => useStore(store, selector),
  pushRedoGroup: api.pushRedoGroup,
  peekRedoGroup: api.peekRedoGroup,
  popRedoGroup: api.popRedoGroup,
  clear: api.clear,
  hasRedo: () => store.getState().redoStack.length > 0,
}
