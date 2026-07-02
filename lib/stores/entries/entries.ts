import type { StoryEntry } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<StoryEntry>()

export const entriesStore = {
  useEntries: store.useRows,
  getEntries: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): StoryEntry | undefined => store.getRows().get(id),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
