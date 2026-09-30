import type {
  CharacterRelationship,
  Entity,
  HappeningAwareness,
  HappeningInvolvement,
  StoryEntry,
} from '@/lib/db'
import { resolveHeadTurn } from '@/lib/head-turn'
import { entityDeleteActions } from '@/lib/world'

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

function count<T>(rows: Iterable<T>, match: (row: T) => boolean): number {
  let n = 0
  for (const row of rows) if (match(row)) n += 1
  return n
}

/**
 * `references`/`unplacedItems`/`tailScene` mirror `entityDeleteActions`; the rest repeat
 * `entityCascade`'s predicates (lib/actions/entities/entity-cascade.ts) — a new cascade table
 * needs a matching count here.
 */
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
  const metadata = head?.tail.metadata
  const plan = entityDeleteActions({
    branchId,
    target: row,
    branchEntities: entities,
    tail:
      head == null || metadata == null
        ? null
        : {
            id: head.tail.id,
            sceneEntities: metadata.sceneEntities,
            currentLocationId: metadata.currentLocationId,
          },
  })
  return {
    awareness: count(awareness, (a) => a.branchId === branchId && a.characterId === row.id),
    involvements: count(involvements, (i) => i.branchId === branchId && i.entityId === row.id),
    relationships: count(
      relationships,
      (r) => r.branchId === branchId && (r.aId === row.id || r.bId === row.id),
    ),
    references: plan.references,
    unplacedItems: plan.unplacedItems,
    tailScene: plan.tailScene,
  }
}
