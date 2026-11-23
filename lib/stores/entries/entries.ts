import type { StoryEntry } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<StoryEntry>()

export const entriesStore = {
  useEntries: store.useRows,
  getEntries: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  hydrate: store.hydrate,
  hydrateIfLoaded: store.hydrateIfLoaded,
  patch: store.patch,
  insertMany: store.insertMany,
  subscribe: store.subscribe,
  __reset: store.__reset,
}
