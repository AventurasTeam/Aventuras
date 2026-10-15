import type { Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { CAST_ID_PREFIX, entitiesStore } from '@/lib/stores'
import {
  entityActions,
  placeSaveRefusal,
  storyLocationIdOf,
  type EntitySaveInput,
} from '@/lib/world'

import { commitRowSave, ROW_SAVE_REJECTION, type RowSaveResult } from '../row-save/commit-row-save'
import { withTailMetadataLock } from '../story-entries/entry-metadata-lock'
import { loadSceneSource } from '../story-entries/head-turn'
import type { DbCtx } from '../types'

export type EntitySaveResult = RowSaveResult

export const ENTITY_REJECTION = ROW_SAVE_REJECTION

type SaveEntityArgs = EntitySaveInput & { branchId: string; row: Entity | null }

function commitEntity(
  args: SaveEntityArgs,
  storyLocationId: string | null,
  ctx: DbCtx,
): Promise<EntitySaveResult> {
  const branchEntities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === args.branchId,
  )
  return commitRowSave(
    'entity',
    {
      branchId: args.branchId,
      rowId: args.row?.id ?? null,
      idPrefix: CAST_ID_PREFIX[args.kind],
      refuse: () => placeSaveRefusal({ ...args, branchEntities, storyLocationId }),
      build: (id) => entityActions({ ...args, id, now: Date.now(), branchEntities }),
    },
    ctx,
  )
}

/**
 * One World pane Save: a create or the changed columns and state paths, plus relationships and a
 * retire's cascade; refused when it breaks a place rule (data-model.md → LocationState shape).
 */
export function saveEntity(args: SaveEntityArgs, ctx: DbCtx): Promise<EntitySaveResult> {
  // Only a location update can hold the story. It reads the story's scene under the tail's lock,
  // as a merge does, so a scene edit can't move the story into the place between read and write.
  if (args.kind !== 'location' || args.row == null) return commitEntity(args, null, ctx)
  const context = { branchId: args.branchId, id: args.row.id, kind: args.kind }
  return withTailMetadataLock<EntitySaveResult>(
    args.branchId,
    ctx,
    async () => {
      const scene = await loadSceneSource(args.branchId, ctx)
      return commitEntity(args, storyLocationIdOf(scene == null ? [] : [scene]), ctx)
    },
    () => {
      const code = ROW_SAVE_REJECTION.inFlight
      logger.warn('action_layer.entity_save_rejected', { ...context, code, reason: 'tail moved' })
      return { status: 'rejected', reason: 'tail moved', code }
    },
  )
}
