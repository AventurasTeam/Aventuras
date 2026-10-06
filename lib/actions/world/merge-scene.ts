import type { CharacterState, Entity, EntityState } from '@/lib/db'
import { dedupeSceneEntities, scenePromotionActions, sceneTrackingActions } from '@/lib/piggyback'
import type { DeleteTail } from '@/lib/world'

import type { PipelineAction } from '../types'

/** The entry before the tail, as the scene editor's tracking anchors on it. */
type PreviousScene = {
  entryId: string
  sceneEntities: string[]
  currentLocationId: string | null
  worldTime: number
}

export type MergeTail = DeleteTail & { previous: PreviousScene }

type EntityPatch = Extract<PipelineAction, { kind: 'updateEntity' }>['payload']['patch']
type MetadataRewrite = Extract<PipelineAction, { kind: 'updateStoryEntryMetadata' }>

function rowPatches(actions: readonly PipelineAction[]): Map<string, EntityPatch> {
  const patches = new Map<string, EntityPatch>()
  for (const action of actions)
    if (action.kind === 'updateEntity') patches.set(action.payload.id, action.payload.patch)
  return patches
}

/**
 * The scene editor's promotion and tracking for a merge that rewrites the tail scene
 * (story-entries/scene-fields.ts), over the entities as the merge leaves them: the loser gone, the
 * canonical at its merged status. A row the plan already updates takes the column there instead,
 * since a group may write each column of a row once.
 */
export function withMergeSceneEffects(input: {
  branchId: string
  actions: readonly PipelineAction[]
  loserId: string
  branchEntities: readonly Entity[]
  tail: MergeTail | null
}): PipelineAction[] {
  const { branchId, actions, loserId, tail } = input
  if (tail == null) return [...actions]
  const rewrite = actions.find(
    (a): a is MetadataRewrite => a.kind === 'updateStoryEntryMetadata' && a.payload.id === tail.id,
  )
  if (rewrite == null) return [...actions]
  const { metadata } = rewrite.payload
  const before = {
    sceneEntities: [...tail.sceneEntities],
    currentLocationId: tail.currentLocationId,
  }
  const after = {
    sceneEntities: dedupeSceneEntities(metadata.sceneEntities ?? before.sceneEntities),
    currentLocationId:
      metadata.currentLocationId === undefined
        ? before.currentLocationId
        : metadata.currentLocationId,
  }

  const patches = rowPatches(actions)
  const entities = input.branchEntities
    .filter((e) => e.id !== loserId)
    .map((e) => ({ ...e, status: patches.get(e.id)?.status ?? e.status }))
  const live = new Set(entities.map((e) => e.id))
  const { previous } = tail
  const anchor =
    previous.currentLocationId != null && live.has(previous.currentLocationId)
      ? previous.currentLocationId
      : null

  const added: PipelineAction[] = []
  for (const promote of scenePromotionActions({
    branchId,
    source: 'user_edit',
    entities,
    sceneEntities: after.sceneEntities,
  })) {
    if (promote.kind !== 'promoteStagedEntity') continue
    const { id } = promote.payload
    const patch = patches.get(id)
    if (patch?.status === undefined) added.push(promote)
    else patches.set(id, { ...patch, status: 'active' })
  }
  for (const track of sceneTrackingActions({
    branchId,
    source: 'user_edit',
    entities,
    previous: {
      ...previous,
      sceneEntities: previous.sceneEntities.filter((id) => live.has(id)),
      currentLocationId: anchor,
    },
    before,
    after,
  })) {
    if (track.kind !== 'updateEntityLocationTracking') continue
    const { id, currentLocationId, lastSeenAt } = track.payload
    const patch = patches.get(id)
    if (patch?.state == null) {
      added.push(track)
      continue
    }
    const state = {
      ...(patch.state as CharacterState),
      ...(currentLocationId === undefined ? {} : { current_location_id: currentLocationId }),
      ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
    }
    patches.set(id, { ...patch, state: state as EntityState })
  }

  const folded = actions.map((action) =>
    action.kind === 'updateEntity'
      ? {
          ...action,
          payload: { ...action.payload, patch: patches.get(action.payload.id) ?? {} },
        }
      : action,
  )
  return [...folded, ...added]
}
