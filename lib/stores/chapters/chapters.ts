import type { StorePatch } from '@/lib/actions'
import type { Chapter } from '@/lib/db'

import { projectChapterPatch } from './chapter-store-projection'
import { createWorkingSetStore } from '../factory/working-set-store'

export type StoreChapter = Omit<Chapter, 'closeReport'> & { hasCloseReport: boolean }

const store = createWorkingSetStore<StoreChapter>()

export const chaptersStore = {
  useChapters: store.useRows,
  getChapters: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): StoreChapter | undefined => store.getRows().get(id),
  getBySequenceNumber: (sequenceNumber: number): StoreChapter | undefined => {
    for (const c of store.getRows().values()) if (c.sequenceNumber === sequenceNumber) return c
    return undefined
  },
  hydrate: store.hydrate,
  // C4's projection on every write, so no caller can put a report into the store.
  patch: (branchId: string, patch: StorePatch): void =>
    store.patch(branchId, projectChapterPatch(patch)),
  __reset: store.__reset,
}
