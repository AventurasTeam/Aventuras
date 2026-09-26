import type { RelationshipBaseLink, RelationshipDraft, RelationshipLink } from '@/lib/world'

import { useDraftBase } from '../use-draft-base'

/** Committed links a Relationships draft was based on (Save's three-way diff); see useDraftBase. */
export function useRelationshipsBase(dirty: boolean, links: readonly RelationshipLink[]) {
  const { base, markSaved } = useDraftBase<readonly RelationshipBaseLink[]>(dirty, links)
  return {
    base,
    markSaved: (relationships: readonly RelationshipDraft[]) =>
      markSaved(
        relationships.map((r) => ({
          otherId: r.otherId,
          selfToOther: r.selfToOther,
          otherToSelf: r.otherToSelf,
        })),
      ),
  }
}
