import type { EntitySummary } from '@/components/compounds/collision-resolve-diff'
import type {
  CharacterRelationship,
  Entity,
  Happening,
  HappeningAwareness,
  HappeningInvolvement,
  Translation,
} from '@/lib/db'
import { compareAge } from '@/lib/list-modules'
import {
  entityLinkRows,
  mergeLinks,
  referencingEntities,
  stateOf,
  unheldItemsWithout,
  type StoryPlace,
} from '@/lib/world'

export type CollisionSources = {
  branchEntities: readonly Entity[]
  branchHappenings: readonly Happening[]
  branchAwareness: readonly HappeningAwareness[]
  branchInvolvements: readonly HappeningInvolvement[]
  branchRelationships: readonly CharacterRelationship[]
  branchTranslations: readonly Translation[]
  /** Where the story is (`storyPlaceOf`), for a merge's placement footnote. */
  story: StoryPlace
}

function isOlder(a: Entity, b: Entity): boolean {
  return compareAge(a, b) < 0
}

function linksOf(id: string, sources: CollisionSources) {
  return entityLinkRows({
    id,
    branchAwareness: sources.branchAwareness,
    branchInvolvements: sources.branchInvolvements,
    branchRelationships: sources.branchRelationships,
  })
}

const joins = (row: CharacterRelationship, id: string) => row.aId === id || row.bId === id

/** What merging this row into `partner` does: `partner` is the canonical. */
function summarize(entity: Entity, partner: Entity, sources: CollisionSources): EntitySummary {
  const links = linksOf(entity.id, sources)
  const merge = mergeLinks({
    canonical: partner,
    loser: entity,
    branchEntities: sources.branchEntities,
    branchHappenings: sources.branchHappenings,
    branchAwareness: sources.branchAwareness,
    branchInvolvements: sources.branchInvolvements,
    branchRelationships: sources.branchRelationships,
    story: sources.story,
  })
  const relationshipIds = new Set(links.relationships.map((row) => row.id))
  const inverseRefs = referencingEntities(entity.id, sources.branchEntities).filter(
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
      awarenessRows: merge.rows.awareness.length,
      involvements: merge.rows.involvements.length,
      relationships: merge.rows.relationships.length,
      joiningRelationship: links.relationships.some((row) => joins(row, partner.id)),
      inverseRefs,
      embeddings: entity.embeddingStale === 0 ? 1 : 0,
      translationRows: sources.branchTranslations.filter(
        (row) =>
          (row.targetKind === 'entity' && row.targetId === entity.id) ||
          (row.targetKind === 'character_relationship' && relationshipIds.has(row.targetId)),
      ).length,
      unheldItems: unheldItemsWithout(entity.id, sources.branchEntities),
      overlap: merge.overlap,
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
  const first = sources.branchEntities.find((e) => e.id === ids[0])
  const second = sources.branchEntities.find((e) => e.id === ids[1])
  if (first == null || second == null || first.id === second.id) return null
  const [older, newer]: readonly [Entity, Entity] = isOlder(first, second)
    ? [first, second]
    : [second, first]
  return [summarize(older, newer, sources), summarize(newer, older, sources)]
}
