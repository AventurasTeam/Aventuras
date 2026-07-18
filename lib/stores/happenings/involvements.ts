import type { HappeningInvolvement } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<HappeningInvolvement>()

export const happeningInvolvementsStore = {
  useInvolvements: store.useRows,
  getInvolvements: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): HappeningInvolvement | undefined => store.getRows().get(id),
  getByHappening: (happeningId: string): readonly HappeningInvolvement[] =>
    Array.from(store.getRows().values()).filter((r) => r.happeningId === happeningId),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
