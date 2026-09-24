import { useState } from 'react'

import type { RelationshipDraft, RelationshipLink } from '@/lib/world'

/**
 * The committed links a Relationships draft was based on, for Save's three-way diff. Follows
 * `links` while clean; frozen at the links of the render where `dirty` first holds; after
 * `markSaved`, the list as saved (typing during the save keeps it dirty).
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
