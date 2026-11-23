import type { StorePatch } from '@/lib/actions'
import type { Chapter } from '@/lib/db'

import { projectChapterPatch, type CloseReportFields } from './chapter-store-projection'
import { createWorkingSetStore } from '../factory/working-set-store'

export type StoreChapter = Omit<Chapter, 'closeReport'> & CloseReportFields

const store = createWorkingSetStore<StoreChapter>()

function latestOf(rows: ReadonlyMap<string, StoreChapter>): StoreChapter | undefined {
  let latest: StoreChapter | undefined
  for (const c of rows.values())
    if (latest == null || c.sequenceNumber > latest.sequenceNumber) latest = c
  return latest
}

export const chaptersStore = {
  useChapters: store.useRows,
  getChapters: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  getBySequenceNumber: (
    branchId: string | null,
    sequenceNumber: number,
  ): StoreChapter | undefined => {
    for (const c of store.getRows(branchId).values())
      if (c.sequenceNumber === sequenceNumber) return c
    return undefined
  },
  /** The branch's highest-numbered chapter; `selectLatest` is the same read as a `useChapters` selector. */
  getLatest: (branchId: string | null): StoreChapter | undefined =>
    latestOf(store.getRows(branchId)),
  selectLatest: latestOf,
  hydrate: store.hydrate,
  // C4's projection on every write, so no caller can put a report into the store.
  patch: (branchId: string, patch: StorePatch): void =>
    store.patch(branchId, projectChapterPatch(patch)),
  __reset: store.__reset,
}
