import type { Entity } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<Entity>()

export const entitiesStore = {
  useEntities: store.useRows,
  getEntities: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): Entity | undefined => store.getRows().get(id),
  getByKind: (kind: Entity['kind']): Entity[] =>
    [...store.getRows().values()].filter((e) => e.kind === kind),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
