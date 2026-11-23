import type { CharacterRelationship, Entity, Happening, HappeningInvolvement } from '@/lib/db'
import { collate, compareId } from '@/lib/list-modules'
import type { RelationshipLink } from '@/lib/world'

export type EntityInvolvement = {
  id: string
  happeningId: string
  title: string
  role: string | null
}

const NO_RELATIONSHIP_LINKS: RelationshipLink[] = []
const NO_INVOLVEMENTS: EntityInvolvement[] = []

/** data-model.md → Lookup helper: both columns read, oriented to the character, by other name. */
export function relationshipLinksFor(
  characterId: string | null,
  branchRelationships: ReadonlyMap<string, CharacterRelationship>,
  entities: readonly Entity[],
): RelationshipLink[] {
  if (characterId == null) return NO_RELATIONSHIP_LINKS
  const names = new Map(entities.map((e) => [e.id, e.name]))
  const links: RelationshipLink[] = []
  for (const row of branchRelationships.values()) {
    if (row.aId !== characterId && row.bId !== characterId) continue
    const isA = row.aId === characterId
    links.push({
      rowId: row.id,
      otherId: isA ? row.bId : row.aId,
      selfToOther: isA ? row.kind : row.inverseKind,
      otherToSelf: isA ? row.inverseKind : row.kind,
    })
  }
  return links.sort(
    (a, b) =>
      collate(names.get(a.otherId) ?? '', names.get(b.otherId) ?? '') ||
      compareId(a.otherId, b.otherId),
  )
}

export function involvementsFor(
  entityId: string | null,
  branchInvolvements: ReadonlyMap<string, HappeningInvolvement>,
  branchHappenings: ReadonlyMap<string, Happening>,
): EntityInvolvement[] {
  if (entityId == null) return NO_INVOLVEMENTS
  const out: EntityInvolvement[] = []
  for (const row of branchInvolvements.values()) {
    if (row.entityId !== entityId) continue
    const happening = branchHappenings.get(row.happeningId)
    if (happening == null) continue
    out.push({ id: row.id, happeningId: row.happeningId, title: happening.title, role: row.role })
  }
  return out.sort((a, b) => collate(a.title, b.title) || compareId(a.id, b.id))
}
