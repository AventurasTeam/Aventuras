import type { CharacterRelationship, Entity, Happening, HappeningInvolvement } from '@/lib/db'
import { collate, compareId } from '@/lib/list-modules'
import type { RelationshipLink } from '@/lib/world'

export type EntityInvolvement = {
  id: string
  happeningId: string
  title: string
  role: string | null
}

/** data-model.md → Lookup helper: both columns read, oriented to the character, by other name. */
export function relationshipLinksFor(
  characterId: string | null,
  branchId: string,
  rows: ReadonlyMap<string, CharacterRelationship>,
  entities: readonly Entity[],
): RelationshipLink[] {
  if (characterId == null) return []
  const names = new Map(entities.map((e) => [e.id, e.name]))
  const links: RelationshipLink[] = []
  for (const row of rows.values()) {
    if (row.branchId !== branchId || (row.aId !== characterId && row.bId !== characterId)) continue
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
  branchId: string,
  involvements: ReadonlyMap<string, HappeningInvolvement>,
  happenings: ReadonlyMap<string, Happening>,
): EntityInvolvement[] {
  if (entityId == null) return []
  const out: EntityInvolvement[] = []
  for (const row of involvements.values()) {
    if (row.branchId !== branchId || row.entityId !== entityId) continue
    const happening = happenings.get(row.happeningId)
    if (happening == null) continue
    out.push({ id: row.id, happeningId: row.happeningId, title: happening.title, role: row.role })
  }
  return out.sort((a, b) => collate(a.title, b.title) || compareId(a.id, b.id))
}
