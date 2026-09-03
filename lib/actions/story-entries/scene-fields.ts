import { desc, eq } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { scenePromotionActions, sceneTrackingActions } from '@/lib/piggyback'
import { entitiesStore, generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import { withKeyLock } from '../delta/key-lock'
import type { DbCtx, PipelineAction } from '../types'
import type { StoryEntryRejection } from './operational'
import { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './register'
import { entryMetadataLockKey } from './world-time'

export type SceneFieldsEdit = {
  sceneEntities: string[]
  /** Omitted leaves the entry's current location untouched. */
  currentLocationId?: string | null
}

export type UpdateSceneFieldsResult = { status: 'ok' } | StoryEntryRejection

function rejected(code: StoryEntryRejectionCode, reason: string): StoryEntryRejection {
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
  return withKeyLock(entryMetadataLockKey(branchId, id), () =>
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

  const rows = await ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
    .limit(2)

  const tail = rows[0]
  if (!tail) return rejected(STORY_ENTRY_REJECTION.notFound, `branch ${branchId} has no entries`)
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
    sceneEntities: edit.sceneEntities,
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

  const previousEntry = rows[1]
  const previousMetadata = previousEntry?.metadata
  const actionId = generateId('act')

  const branchEntities = [...entitiesStore.getEntities().values()]
  const group: PipelineAction[] = [
    {
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: { branchId, id, metadata: after },
    },
    // Promotion first: a staged entity the edit brings into the scene is promoted
    // exactly as the generation fold would, which is what the editor's copy promises.
    ...scenePromotionActions({
      branchId,
      source: 'user_edit',
      entities: branchEntities,
      sceneEntities: after.sceneEntities,
    }),
    ...sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities: branchEntities,
      previous: {
        entryId: previousEntry?.id ?? id,
        sceneEntities: previousMetadata?.sceneEntities ?? [],
        currentLocationId: previousMetadata?.currentLocationId ?? null,
        worldTime: previousMetadata?.worldTime ?? 0,
      },
      before,
      after,
    }),
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
