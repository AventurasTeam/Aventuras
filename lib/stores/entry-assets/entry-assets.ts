import type { EntryAsset } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<EntryAsset>()

export const entryAssetsStore = {
  useEntryAssets: store.useRows,
  getEntryAssets: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): EntryAsset | undefined => store.getRows().get(id),
  // entry_assets.position is the data-model's ordering-within-entry; unpositioned rows sort last.
  getByEntry: (entryId: string): EntryAsset[] =>
    Array.from(store.getRows().values())
      .filter((r) => r.entryId === entryId)
      .sort((a, b) => {
        const ap = a.position ?? Number.POSITIVE_INFINITY
        const bp = b.position ?? Number.POSITIVE_INFINITY
        return ap - bp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      }),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
