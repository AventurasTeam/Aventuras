import type { Chapter } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<Chapter>()

export const chaptersStore = {
  useChapters: store.useRows,
  getChapters: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): Chapter | undefined => store.getRows().get(id),
  getBySequenceNumber: (sequenceNumber: number): Chapter | undefined => {
    for (const c of store.getRows().values()) if (c.sequenceNumber === sequenceNumber) return c
    return undefined
  },
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
