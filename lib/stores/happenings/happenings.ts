import type { Happening } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<Happening>()

export const happeningsStore = {
  useHappenings: store.useRows,
  getHappenings: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
