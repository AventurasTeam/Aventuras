import type { BranchEraFlip } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<BranchEraFlip>()

export const eraFlipsStore = {
  useEraFlips: store.useRows,
  getEraFlips: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): BranchEraFlip | undefined => store.getRows().get(id),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
