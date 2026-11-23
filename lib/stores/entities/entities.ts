import type { Entity } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<Entity>()

export const entitiesStore = {
  useEntities: store.useRows,
  getEntities: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  getByKind: (branchId: string | null, kind: Entity['kind']): readonly Entity[] =>
    [...store.getRows(branchId).values()].filter((e) => e.kind === kind),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
