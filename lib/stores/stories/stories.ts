import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { Story as StoryRow } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

export type OpenFailureKind = 'definition-corrupt' | 'settings-corrupt'
export type OpenFailure = { storyId: string; kind: OpenFailureKind }

type StoriesSnapshot = { rows: StoryRow[]; openFailures: Record<string, OpenFailureKind> }

type StoriesState = StoriesSnapshot & {
  apply: (rows: StoryRow[]) => void
  setOpenFailure: (failure: OpenFailure) => void
  clearOpenFailure: (storyId: string) => void
  __reset: () => void
}

const store = createStore<StoriesState>()((set) => ({
  rows: [],
  openFailures: {},
  apply: (rows) => set({ rows }),
  setOpenFailure: ({ storyId, kind }) =>
    set((s) => ({ openFailures: { ...s.openFailures, [storyId]: kind } })),
  clearOpenFailure: (storyId) =>
    set((s) => {
      if (!(storyId in s.openFailures)) return s
      const next = { ...s.openFailures }
      delete next[storyId]
      return { openFailures: next }
    }),
  __reset: () => set({ rows: [], openFailures: {} }),
}))

function useStories<T>(selector: (s: StoriesSnapshot) => T): T {
  return useStore(store, selector as (s: StoriesState) => T)
}

function getStories(): StoriesSnapshot {
  const s = store.getState()
  return { rows: s.rows, openFailures: s.openFailures }
}

/** Hydrate-apply half (DB read is the caller's thunk). Re-read keeps the mirror a pure function of SQLite. */
export async function hydrateStories(read: () => Promise<StoryRow[]>): Promise<void> {
  try {
    store.getState().apply(await read())
  } catch (err) {
    // Post-write re-hydrate keeps the current store on a transient read failure (write already committed).
    logger.error('bootstrap.stories_hydrate_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

const api = store.getState()
export const storiesStore = {
  useStories,
  getStories,
  setOpenFailure: api.setOpenFailure,
  clearOpenFailure: api.clearOpenFailure,
  __reset: api.__reset,
}

export type { StoriesSnapshot, StoriesState }
