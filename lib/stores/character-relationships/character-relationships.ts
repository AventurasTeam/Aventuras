import type { CharacterRelationship } from '@/lib/db'

import { createWorkingSetStore } from '../factory/working-set-store'

export type RelationshipView = {
  rowId: string
  otherId: string
  selfToOther: string | null
  otherToSelf: string | null
}

const store = createWorkingSetStore<CharacterRelationship>()

export const characterRelationshipsStore = {
  useRelationships: store.useRows,
  getRelationshipRows: store.getRows,
  getLoadedBranch: store.getLoadedBranch,
  getById: (id: string): CharacterRelationship | undefined => store.getRows().get(id),
  getRelationships: (characterId: string, branchId: string): readonly RelationshipView[] => {
    if (store.getLoadedBranch() !== branchId) return []
    const out: RelationshipView[] = []
    for (const r of store.getRows().values()) {
      if (r.aId !== characterId && r.bId !== characterId) continue
      const isA = r.aId === characterId
      out.push({
        rowId: r.id,
        otherId: isA ? r.bId : r.aId,
        selfToOther: isA ? r.kind : r.inverseKind,
        otherToSelf: isA ? r.inverseKind : r.kind,
      })
    }
    return out
  },
  hydrate: store.hydrate,
  patch: store.patch,
  __reset: store.__reset,
}
