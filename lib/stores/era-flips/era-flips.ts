import type { BranchEraFlip } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<BranchEraFlip>()

export const eraFlipsStore = {
  useEraFlips: store.useRows,
  getEraFlips: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
