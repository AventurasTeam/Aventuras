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
  // Marks each explicit open: a re-open keeps the story id, and saves re-`set` a spread copy.
  openSeq: number
  /** Refresh path — replaces the open story without marking an open. */
  set: (open: OpenStory) => void
  markOpen: (open: OpenStory) => void
  clear: () => void
  __reset: () => void
}

const store = createStore<CurrentStoryState>()((set) => ({
  open: null,
  openSeq: 0,
  set: (open) => set({ open }),
  markOpen: (open) => set((s) => ({ open, openSeq: s.openSeq + 1 })),
  clear: () => set({ open: null }),
  __reset: () => set({ open: null, openSeq: 0 }),
}))

function useCurrentStory<T>(selector: (open: OpenStory | null) => T): T {
  return useStore(store, (s) => selector(s.open))
}

function useOpenSeq(): number {
  return useStore(store, (s) => s.openSeq)
}

function getCurrentStory(): OpenStory | null {
  return store.getState().open
}

function getOpenSeq(): number {
  return store.getState().openSeq
}

const api = store.getState()

export const currentStoryStore = {
  useCurrentStory,
  useOpenSeq,
  getCurrentStory,
  getOpenSeq,
  set: api.set,
  open: api.markOpen,
  clear: api.clear,
  __reset: api.__reset,
}
