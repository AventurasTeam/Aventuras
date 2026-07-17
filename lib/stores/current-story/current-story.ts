import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { StoryDefinition, StorySettings } from '@/lib/db'

export type OpenStory = {
  storyId: string
  branchId: string
  definition: StoryDefinition
  settings: StorySettings
}

type CurrentStoryState = {
  open: OpenStory | null
  set: (open: OpenStory) => void
  clear: () => void
  __reset: () => void
}

const store = createStore<CurrentStoryState>()((set) => ({
  open: null,
  set: (open) => set({ open }),
  clear: () => set({ open: null }),
  __reset: () => set({ open: null }),
}))

function useCurrentStory<T>(selector: (open: OpenStory | null) => T): T {
  return useStore(store, (s) => selector(s.open))
}

function getCurrentStory(): OpenStory | null {
  return store.getState().open
}

const api = store.getState()

export const currentStoryStore = {
  useCurrentStory,
  getCurrentStory,
  set: api.set,
  clear: api.clear,
  __reset: api.__reset,
}
