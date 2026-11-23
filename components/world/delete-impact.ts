import type {
  CharacterRelationship,
  Entity,
  HappeningAwareness,
  HappeningInvolvement,
  StoryEntry,
} from '@/lib/db'
import { resolveHeadTurn } from '@/lib/head-turn'
import { deleteTailOf, entityDeleteActions, entityLinkRows } from '@/lib/world'

export type EntityDeleteImpact = {
  awareness: number
  involvements: number
  relationships: number
  references: number
  unplacedItems: number
  unplacedPlaces: number
  tailScene: boolean
}

type ImpactInput = {
  branchId: string
  row: Entity
  branchEntities: readonly Entity[]
  branchEntries: Iterable<StoryEntry>
  branchAwareness: Iterable<HappeningAwareness>
  branchInvolvements: Iterable<HappeningInvolvement>
  branchRelationships: Iterable<CharacterRelationship>
}

/** Mirrors `entityDeleteActions` for refs, items and the tail; `entityLinkRows` for link counts. */
export function entityDeleteImpact({
  branchId,
  row,
  branchEntities,
  branchEntries,
  branchAwareness,
  branchInvolvements,
  branchRelationships,
}: ImpactInput): EntityDeleteImpact {
  const head = resolveHeadTurn([...branchEntries].sort((a, b) => a.position - b.position))
  const plan = entityDeleteActions({
    branchId,
    target: row,
    branchEntities,
    tail: deleteTailOf(head),
  })
  const links = entityLinkRows({
    id: row.id,
    branchAwareness,
    branchInvolvements,
    branchRelationships,
  })
  return {
    awareness: links.awareness.length,
    involvements: links.involvements.length,
    relationships: links.relationships.length,
    references: plan.references,
    unplacedItems: plan.unplacedItems,
    unplacedPlaces: plan.unplacedPlaces,
    tailScene: plan.tailScene,
  }
}
