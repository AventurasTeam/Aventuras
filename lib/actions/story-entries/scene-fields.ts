import { desc, eq } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { sceneTrackingActions } from '@/lib/piggyback'
import { entitiesStore, generationStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { withKeyLock } from '../delta/key-lock'
import type { DbCtx } from '../types'
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
 * (docs/ui/patterns/entry-card.md → Scene editor).
 *
 * Restricted to the branch's last story entry: `sceneEntities` and
 * `currentLocationId` drive materialized derived state — per-character
 * `current_location_id`, `lastSeenAt`, staged promotion — which is a fold over
 * entries, so only the tail can be re-folded with nothing downstream to invalidate.
 *
 * Forward-diff rather than reverse-then-reapply. Reversing the turn's delta group
 * would also reverse the `visualChanges` and `transfers` this edit never touched, and
 * "tail story entry" is not "tail of the delta log" — classifier writes lag, which is
 * why the survival anchor exists.
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

  const metadataResult = await applyDeltaAction(
    {
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        payload: { branchId, id, metadata: after },
      },
      actionId,
      branchId,
      // Survival anchor: the delta's subject is this entry, so reversing a LATER
      // turn's suffix spares it.
      entryId: id,
    },
    ctx,
  )
  if (metadataResult.status !== 'ok')
    return rejected(STORY_ENTRY_REJECTION.deltaFailed, metadataResult.reason)

  // Same actionId as the metadata write, so undo reverses the correction and the
  // world state it produced as one step.
  const tracking = sceneTrackingActions({
    branchId,
    source: 'user_edit',
    entities: [...entitiesStore.getEntities().values()],
    previous: {
      entryId: previousEntry?.id ?? id,
      sceneEntities: previousMetadata?.sceneEntities ?? [],
      currentLocationId: previousMetadata?.currentLocationId ?? null,
      worldTime: previousMetadata?.worldTime ?? 0,
    },
    before,
    after,
  })
  for (const action of tracking) {
    const result = await applyDeltaAction({ action, actionId, branchId, entryId: id }, ctx)
    // 'noop' is the expected outcome for a character already at the edited location,
    // which forward-diff emits for every in-scene member without checking first — the
    // handler owns that judgement. Treating it as a failure would reject the user's
    // whole correction over a redundant patch.
    if (result.status !== 'ok' && result.code !== 'noop') {
      logger.warn('action_layer.scene_tracking_rejected', {
        branchId,
        entryId: id,
        reason: result.reason,
        code: result.code,
      })
      return rejected(STORY_ENTRY_REJECTION.deltaFailed, result.reason)
    }
  }

  return { status: 'ok' }
}
