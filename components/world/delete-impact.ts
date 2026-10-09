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
  tailScene: boolean
}

type ImpactInput = {
  branchId: string
  row: Entity
  /** The branch's entities. */
  entities: readonly Entity[]
  entries: Iterable<StoryEntry>
  awareness: Iterable<HappeningAwareness>
  involvements: Iterable<HappeningInvolvement>
  relationships: Iterable<CharacterRelationship>
}

/** Mirrors `entityDeleteActions` for refs, items and the tail; `entityLinkRows` for link counts. */
export function entityDeleteImpact({
  branchId,
  row,
  entities,
  entries,
  awareness,
  involvements,
  relationships,
}: ImpactInput): EntityDeleteImpact {
  const head = resolveHeadTurn(
    [...entries].filter((e) => e.branchId === branchId).sort((a, b) => a.position - b.position),
  )
  const plan = entityDeleteActions({
    branchId,
    target: row,
    branchEntities: entities,
    tail: deleteTailOf(head),
  })
  const links = entityLinkRows({ branchId, id: row.id, awareness, involvements, relationships })
  return {
    awareness: links.awareness.length,
    involvements: links.involvements.length,
    relationships: links.relationships.length,
    references: plan.references,
    unplacedItems: plan.unplacedItems,
    tailScene: plan.tailScene,
  }
}
