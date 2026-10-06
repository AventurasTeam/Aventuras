import type { EntitySummary } from '@/components/compounds/collision-resolve-diff'
import type {
  CharacterRelationship,
  Entity,
  HappeningAwareness,
  HappeningInvolvement,
  Translation,
} from '@/lib/db'
import {
  entityLinkRows,
  itemHasPosition,
  referencingEntities,
  stateOf,
  unheldItemsWithout,
} from '@/lib/world'

export type CollisionSources = {
  branchId: string
  /** The branch's rows: the entities, link rows and translations below aren't re-filtered. */
  entities: readonly Entity[]
  awareness: readonly HappeningAwareness[]
  involvements: readonly HappeningInvolvement[]
  relationships: readonly CharacterRelationship[]
  translations: readonly Translation[]
}

function isOlder(a: Entity, b: Entity): boolean {
  return a.createdAt !== b.createdAt ? a.createdAt < b.createdAt : a.id < b.id
}

function linksOf(id: string, sources: CollisionSources) {
  return entityLinkRows({
    branchId: sources.branchId,
    id,
    awareness: sources.awareness,
    involvements: sources.involvements,
    relationships: sources.relationships,
  })
}

const otherEnd = (row: CharacterRelationship, id: string) => (row.aId === id ? row.bId : row.aId)
const joins = (row: CharacterRelationship, id: string) => row.aId === id || row.bId === id

/**
 * `partner` is the pair's other row. The merge drops the relationship joining the two rather than
 * moving it, and collapses the partner's ref to this row instead of rewriting it.
 */
function summarize(entity: Entity, partner: Entity, sources: CollisionSources): EntitySummary {
  const links = linksOf(entity.id, sources)
  const partnerLinks = linksOf(partner.id, sources)
  const partnerKnows = new Set(partnerLinks.awareness.map((row) => row.happeningId))
  const partnerTakesPart = new Set(partnerLinks.involvements.map((row) => row.happeningId))
  const partnerRelatesTo = new Set(
    partnerLinks.relationships.map((row) => otherEnd(row, partner.id)),
  )
  const relationshipIds = new Set(links.relationships.map((row) => row.id))
  const carried = links.relationships.filter((row) => !joins(row, partner.id))
  const inverseRefs = referencingEntities(entity.id, sources.entities).filter(
    (other) => other.id !== partner.id,
  ).length
  return {
    id: entity.id,
    kind: entity.kind,
    createdAt: new Date(entity.createdAt).toISOString(),
    name: entity.name,
    description: entity.description ?? undefined,
    status: entity.status,
    retiredReason: entity.retiredReason ?? undefined,
    injectionMode: entity.injectionMode,
    priority: entity.priority,
    tags: [...entity.tags],
    keywords: [...entity.keywords],
    state: stateOf(entity, entity.kind),
    relationCounts: {
      awarenessRows: links.awareness.length,
      involvements: links.involvements.length,
      relationships: carried.length,
      joiningRelationship: links.relationships.some((row) => joins(row, partner.id)),
      inverseRefs,
      embeddings: entity.embeddingStale === 0 ? 1 : 0,
      translationRows: sources.translations.filter(
        (row) =>
          (row.targetKind === 'entity' && row.targetId === entity.id) ||
          (row.targetKind === 'character_relationship' && relationshipIds.has(row.targetId)),
      ).length,
      unheldItems: unheldItemsWithout(entity.id, sources.entities),
      overlap: {
        awareness: links.awareness.filter((row) => partnerKnows.has(row.happeningId)).length,
        involvements: links.involvements.filter((row) => partnerTakesPart.has(row.happeningId))
          .length,
        relationships: carried.filter((row) => partnerRelatesTo.has(otherEnd(row, entity.id)))
          .length,
        // Holders of this item drop it when the partner already has a position, instead of moving.
        holdersLosingItem:
          entity.kind === 'item' && itemHasPosition(partner, sources.entities) ? inverseRefs : 0,
      },
    },
  }
}

/**
 * collision-resolve.md → Dialog props: older by `createdAt` first (id breaks a tie). Null when a
 * row is gone or the two ids are the same row.
 */
export function collisionPair(
  ids: readonly [string, string],
  sources: CollisionSources,
): readonly [EntitySummary, EntitySummary] | null {
  const first = sources.entities.find((e) => e.id === ids[0])
  const second = sources.entities.find((e) => e.id === ids[1])
  if (first == null || second == null || first.id === second.id) return null
  const [older, newer]: readonly [Entity, Entity] = isOlder(first, second)
    ? [first, second]
    : [second, first]
  return [summarize(older, newer, sources), summarize(newer, older, sources)]
}
