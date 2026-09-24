import { useState } from 'react'

import type { RelationshipDraft, RelationshipLink } from '@/lib/world'

/**
 * Committed links a Relationships draft was based on (Save's three-way diff): `links` while clean,
 * frozen on the first dirty render; after `markSaved`, the saved list (mid-save edits stay dirty).
 */
export function useRelationshipsBase(dirty: boolean, links: readonly RelationshipLink[]) {
  const [frozen, setFrozen] = useState<readonly RelationshipLink[] | null>(null)
  // Render-phase sync, the NumberInput idiom.
  if (dirty && frozen === null) setFrozen(links)
  if (!dirty && frozen !== null) setFrozen(null)
  const markSaved = (relationships: readonly RelationshipDraft[]) =>
    setFrozen(
      relationships.map((r) => ({
        rowId: '',
        otherId: r.otherId,
        selfToOther: r.selfToOther,
        otherToSelf: r.otherToSelf,
      })),
    )
  return { base: frozen ?? links, markSaved }
}
