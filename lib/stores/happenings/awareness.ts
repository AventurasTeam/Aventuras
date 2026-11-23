import type { HappeningAwareness } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

const store = createWorkingSetStore<HappeningAwareness>()

export const happeningAwarenessStore = {
  useAwareness: store.useRows,
  getAwareness: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: store.getById,
  useById: store.useById,
  getByHappening: (branchId: string | null, happeningId: string): readonly HappeningAwareness[] =>
    Array.from(store.getRows(branchId).values()).filter((r) => r.happeningId === happeningId),
  getByCharacter: (branchId: string | null, characterId: string): readonly HappeningAwareness[] =>
    Array.from(store.getRows(branchId).values()).filter((r) => r.characterId === characterId),
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
