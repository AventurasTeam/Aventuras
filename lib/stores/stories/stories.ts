import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { stories, type Story as StoryRow, type dbSchema } from '@/lib/db'
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

type Db = BaseSQLiteDatabase<'async' | 'sync', unknown, typeof dbSchema>

/** Re-read story rows from the caller-supplied DB and apply them — keeps the store a pure function
 *  of SQLite. Takes `db` so a write and its re-hydrate hit the same instance (test isolation). */
export async function rehydrateStories(db: Db): Promise<void> {
  try {
    store.getState().apply(await db.select().from(stories))
  } catch (err) {
    // A transient read failure keeps the current store (the write already committed).
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
