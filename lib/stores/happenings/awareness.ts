import type { HappeningAwareness } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<HappeningAwareness>()

export const happeningAwarenessStore = {
  useAwareness: store.useRows,
  getAwareness: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): HappeningAwareness | undefined => store.getRows().get(id),
  getByHappening: (happeningId: string): readonly HappeningAwareness[] =>
    Array.from(store.getRows().values()).filter((r) => r.happeningId === happeningId),
  getByCharacter: (characterId: string): readonly HappeningAwareness[] =>
    Array.from(store.getRows().values()).filter((r) => r.characterId === characterId),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
