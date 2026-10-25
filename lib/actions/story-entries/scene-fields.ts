import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { dedupeSceneEntities, scenePromotionActions, sceneTrackingActions } from '@/lib/piggyback'
import { entitiesStore, generationStore } from '@/lib/stores'
import { retiredPlaceEntered } from '@/lib/world'

import { loadHeadTurn } from './head-turn'
import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import type { DbCtx, PipelineAction } from '../types'
import { withEntryMetadataLock } from './entry-metadata-lock'
import type { StoryEntryRejection } from './operational'
import { STORY_ENTRY_REJECTION } from './register'

export type SceneFieldsEdit = {
  sceneEntities: string[]
  /** Omitted leaves the entry's current location untouched. */
  currentLocationId?: string | null
}

export type UpdateSceneFieldsResult = { status: 'ok' } | StoryEntryRejection

function rejected(code: StoryEntryRejection['code'], reason: string): StoryEntryRejection {
  return { status: 'rejected', reason, code }
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Applies a scene correction to the entry AND to world state
 * (docs/ui/patterns/entry-card.md → Scene editor). Tail-only because the fields drive a
 * fold over entries, so only the last one re-folds with nothing downstream to
 * invalidate. Forward-diff, not reverse-then-reapply: reversing the turn's group would
 * also undo the `visualChanges` and `transfers` this edit never touched.
 */
export async function updateEntrySceneFields(
  branchId: string,
  id: string,
  edit: SceneFieldsEdit,
  ctx: DbCtx,
): Promise<UpdateSceneFieldsResult> {
  return withEntryMetadataLock(branchId, id, () =>
    updateEntrySceneFieldsLocked(branchId, id, edit, ctx),
  )
}

async function updateEntrySceneFieldsLocked(
  branchId: string,
  id: string,
  edit: SceneFieldsEdit,
  ctx: DbCtx,
): Promise<UpdateSceneFieldsResult> {
  if (generationStore.isUserEditBlocked())
    return rejected(STORY_ENTRY_REJECTION.inFlight, 'generation in flight')

  const head = await loadHeadTurn(branchId, ctx)
  if (!head) return rejected(STORY_ENTRY_REJECTION.notFound, `branch ${branchId} has no entries`)
  const tail = head.tail
  if (tail.id !== id)
    return rejected(
      STORY_ENTRY_REJECTION.notTailEntry,
      `scene fields are editable on the last entry only; ${id} is not it`,
    )
  if (tail.metadata == null)
    return rejected(STORY_ENTRY_REJECTION.noMetadata, `entry ${id} has no metadata to edit`)

  const before = {
    sceneEntities: tail.metadata.sceneEntities,
    currentLocationId: tail.metadata.currentLocationId,
  }
  const after = {
    sceneEntities: dedupeSceneEntities(edit.sceneEntities),
    currentLocationId:
      edit.currentLocationId === undefined ? before.currentLocationId : edit.currentLocationId,
  }
  // A no-op delta would clear the global redo stack for nothing. Membership, not
  // order: the scene is a set, and the editor's control emits in its own order.
  if (
    sameMembers(after.sceneEntities, before.sceneEntities) &&
    after.currentLocationId === before.currentLocationId
  )
    return { status: 'ok' }

  // Re-checked after the awaited read: the gate above is a TOCTOU window, and a
  // hard-gate run starting inside it would race this write.
  if (generationStore.isUserEditBlocked())
    return rejected(STORY_ENTRY_REJECTION.inFlight, 'generation in flight')

  const previousEntry = head.previous
  const previousMetadata = previousEntry?.metadata
  const actionId = generateId('act')

  const branchEntities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === branchId,
  )
  // The editor offers places only; the action layer holds the line for any other caller. A scene
  // already at an id that names no place keeps it until it is changed, as a retired place does.
  const locationChanged = after.currentLocationId !== before.currentLocationId
  if (
    locationChanged &&
    after.currentLocationId !== null &&
    branchEntities.find((e) => e.id === after.currentLocationId)?.kind !== 'location'
  )
    return rejected(
      STORY_ENTRY_REJECTION.notALocation,
      `${after.currentLocationId} is not a location on branch ${branchId}`,
    )
  // Nothing enters a retired place (data-model.md → LocationState shape); a scene already in one
  // keeps it until it is changed.
  if (
    retiredPlaceEntered(after.currentLocationId, before.currentLocationId, branchEntities) != null
  )
    return rejected(
      STORY_ENTRY_REJECTION.retiredPlace,
      `location ${after.currentLocationId} is retired`,
    )
  // An entity delete clears only the tail's scene fields; the entries before it keep the id,
  // and tracking anchored there would write the deleted location back.
  const live = new Set(branchEntities.map((e) => e.id))
  const previousLocationId = previousMetadata?.currentLocationId ?? null
  // A kept tail location that names no place stays on the entry but is written to no character.
  const unplacedLocation =
    after.currentLocationId !== null &&
    branchEntities.find((e) => e.id === after.currentLocationId)?.kind !== 'location'
      ? after.currentLocationId
      : null
  const group: PipelineAction[] = [
    {
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: { branchId, id, metadata: after },
    },
    // Promotion first: a staged scene member, or a staged place the edit moves the scene to, is
    // promoted as the generation fold promotes one; an unchanged location promotes nothing.
    ...scenePromotionActions({
      branchId,
      source: 'user_edit',
      entities: branchEntities,
      sceneEntities: after.sceneEntities,
      alsoIds: locationChanged && after.currentLocationId !== null ? [after.currentLocationId] : [],
    }),
    ...sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities: branchEntities,
      previous: {
        entryId: previousEntry?.id ?? id,
        currentLocationId:
          previousLocationId != null && live.has(previousLocationId) ? previousLocationId : null,
        worldTime: previousMetadata?.worldTime ?? 0,
        sceneEntities: previousMetadata?.sceneEntities ?? [],
      },
      before,
      after,
    }).filter(
      (action) =>
        unplacedLocation === null ||
        action.kind !== 'updateEntityLocationTracking' ||
        action.payload.currentLocationId !== unplacedLocation,
    ),
  ]

  // One transaction under one actionId: a partial commit would report total failure over
  // an already-changed scene, and the retry it invites short-circuits on sameMembers.
  // entryId anchors survival — reversing a LATER turn's suffix spares this entry.
  const result = await applyDeltaActionGroup(group, { actionId, branchId, entryId: id }, ctx)
  if (result.status !== 'ok') {
    logger.warn('action_layer.scene_edit_rejected', {
      branchId,
      entryId: id,
      reason: result.reason,
      code: result.code,
    })
    return rejected(STORY_ENTRY_REJECTION.deltaFailed, result.reason)
  }

  return { status: 'ok' }
}
