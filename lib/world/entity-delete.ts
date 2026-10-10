import type { PipelineAction } from '@/lib/actions'
import type { Entity, StoryEntry } from '@/lib/db'

import { flagsNaming, withFlagClears } from './collision-flags'
import { stateOf } from './entity-draft'
import { heldElsewhere, stateWithRefRewritten, unheldItemsWithout } from './entity-refs'

export type DeleteTail = {
  id: string
  sceneEntities: readonly string[]
  currentLocationId: string | null
}

/** The head turn's tail as a delete or merge plans against it. */
export function deleteTailOf(
  head: { tail: Pick<StoryEntry, 'id' | 'metadata'> } | null,
): DeleteTail | null {
  const metadata = head?.tail.metadata
  return head == null || metadata == null
    ? null
    : {
        id: head.tail.id,
        sceneEntities: metadata.sceneEntities,
        currentLocationId: metadata.currentLocationId,
      }
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

/** `fromId` replaced by `toId` in place with `toId` kept once, or dropped when `toId` is null. */
function sceneRewritten(scene: readonly string[], fromId: string, toId: string | null): string[] {
  const out: string[] = []
  for (const id of scene) {
    const next = id === fromId ? toId : id
    if (next == null || (next === toId && out.includes(next))) continue
    out.push(next)
  }
  return out
}

/** The tail's scene fields with `fromId` pointed at `toId`, or dropped when `toId` is null. */
export function tailSceneActions(
  branchId: string,
  tail: DeleteTail | null,
  fromId: string,
  toId: string | null,
): PipelineAction[] {
  if (tail == null) return []
  const metadata: { sceneEntities?: string[]; currentLocationId?: string | null } = {}
  if (tail.sceneEntities.includes(fromId))
    metadata.sceneEntities = sceneRewritten(tail.sceneEntities, fromId, toId)
  if (tail.currentLocationId === fromId) metadata.currentLocationId = toId
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
 * world.md → Delete, collision flags naming the target included. Handlers read pre-group state:
 * order is free. Replaces the whole `state` from this snapshot: a write landing in between is
 * lost — safe only while nothing else writes `state` alongside user edits (the classifier doesn't).
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
  const tailDrop = tailSceneActions(branchId, tail, target.id, null)
  const naming = flagsNaming(branchEntities, new Set([target.id]))
  return {
    actions: [
      ...withFlagClears([...updates, ...tailDrop], branchId, naming),
      { kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id: target.id } },
    ],
    references: updates.length,
    unplacedItems: unplacedItems(target, branchEntities),
    tailScene: tailDrop.length > 0,
  }
}
