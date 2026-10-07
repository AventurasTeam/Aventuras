import type { PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'

import { orphanedFlags, withFlagClears } from './collision-flags'
import { stateOf } from './entity-draft'
import { heldElsewhere, stateWithRefRewritten, unheldItemsWithout } from './entity-refs'

export type DeleteTail = {
  id: string
  sceneEntities: readonly string[]
  currentLocationId: string | null
}

export type EntityDeleteInput = {
  branchId: string
  target: Entity
  /** The branch's entities at delete time, the target among them. */
  branchEntities: readonly Entity[]
  /** The narrative tail's scene fields; null when the branch has no tail or it carries none. */
  tail: DeleteTail | null
}

export type EntityDeletePlan = {
  actions: PipelineAction[]
  /** Other entities whose state named the target. */
  references: number
  /** Items the delete leaves with neither a location nor a holder (data-model.md → ItemState). */
  unplacedItems: number
  /** Whether the tail's scene named the target. */
  tailScene: boolean
}

function unplacedItems(target: Entity, branchEntities: readonly Entity[]): number {
  const othersHold = heldElsewhere(target.id, branchEntities)
  const atTarget = branchEntities.filter(
    (item) =>
      item.kind === 'item' &&
      !othersHold.has(item.id) &&
      stateOf(item, 'item').at_location_id === target.id,
  ).length
  return unheldItemsWithout(target.id, branchEntities) + atTarget
}

function tailActions(branchId: string, tail: DeleteTail | null, id: string): PipelineAction[] {
  if (tail == null) return []
  const metadata: { sceneEntities?: string[]; currentLocationId?: null } = {}
  if (tail.sceneEntities.includes(id))
    metadata.sceneEntities = tail.sceneEntities.filter((other) => other !== id)
  if (tail.currentLocationId === id) metadata.currentLocationId = null
  if (Object.keys(metadata).length === 0) return []
  return [
    {
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: { branchId, id: tail.id, metadata },
    },
  ]
}

/**
 * world.md → Delete, plus clears for orphaned flags. Handlers read pre-group state: order is free.
 * Replaces the whole `state` from this snapshot, so a write landing in between is lost — safe only
 * while nothing else writes `state` alongside user edits (the periodic classifier doesn't).
 */
export function entityDeleteActions({
  branchId,
  target,
  branchEntities,
  tail,
}: EntityDeleteInput): EntityDeletePlan {
  const updates: PipelineAction[] = []
  for (const other of branchEntities) {
    if (other.id === target.id) continue
    const state = stateWithRefRewritten(other, target.id, null)
    if (state == null) continue
    updates.push({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId, id: other.id, patch: { state } },
    })
  }
  const tailDrop = tailActions(branchId, tail, target.id)
  const orphans = orphanedFlags({ entities: branchEntities, removed: new Set([target.id]) })
  return {
    actions: [
      ...withFlagClears([...updates, ...tailDrop], branchId, orphans),
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id: target.id } },
    ],
    references: updates.length,
    unplacedItems: unplacedItems(target, branchEntities),
    tailScene: tailDrop.length > 0,
  }
}
