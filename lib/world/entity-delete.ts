import type { PipelineAction } from '@/lib/actions'
import type { Entity, EntityState } from '@/lib/db'

import { heldItems, stateOf } from './entity-draft'

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

function without(ids: readonly string[] | undefined, id: string): string[] | null {
  return ids != null && ids.includes(id) ? ids.filter((other) => other !== id) : null
}

/**
 * Reads through `stateOf`, not raw `state`: a legacy row missing a key still produces a
 * schema-valid patch.
 */
function stateWithout(entity: Entity, id: string): EntityState | null {
  switch (entity.kind) {
    case 'character': {
      const current = stateOf(entity, 'character')
      const next = { ...current }
      let changed = false
      if (current.current_location_id === id) {
        next.current_location_id = null
        changed = true
      }
      if (current.faction_id === id) {
        next.faction_id = null
        changed = true
      }
      const equipped = without(current.equipped_items, id)
      if (equipped != null) {
        next.equipped_items = equipped
        changed = true
      }
      const inventory = without(current.inventory, id)
      if (inventory != null) {
        next.inventory = inventory
        changed = true
      }
      return changed ? next : null
    }
    case 'location': {
      const current = stateOf(entity, 'location')
      return current.parent_location_id === id ? { ...current, parent_location_id: null } : null
    }
    case 'item': {
      const current = stateOf(entity, 'item')
      return current.at_location_id === id ? { ...current, at_location_id: null } : null
    }
    case 'faction':
      return null
  }
}

function heldBy(entity: Entity): string[] {
  return entity.kind === 'character' ? heldItems(stateOf(entity, 'character')) : []
}

function unplacedItems(target: Entity, branchEntities: readonly Entity[]): number {
  const heldByTarget = new Set(heldBy(target))
  const heldElsewhere = new Set(
    branchEntities.filter((e) => e.id !== target.id).flatMap((e) => heldBy(e)),
  )
  return branchEntities.filter((item) => {
    if (item.kind !== 'item' || heldElsewhere.has(item.id)) return false
    const at = stateOf(item, 'item').at_location_id
    return (heldByTarget.has(item.id) && at == null) || at === target.id
  }).length
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
 * world.md → Delete order: handlers read pre-group state, so patch/tail/delete order doesn't matter.
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
    const state = stateWithout(other, target.id)
    if (state == null) continue
    updates.push({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId, id: other.id, patch: { state } },
    })
  }
  const tailDrop = tailActions(branchId, tail, target.id)
  return {
    actions: [
      ...updates,
      ...tailDrop,
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id: target.id } },
    ],
    references: updates.length,
    unplacedItems: unplacedItems(target, branchEntities),
    tailScene: tailDrop.length > 0,
  }
}
