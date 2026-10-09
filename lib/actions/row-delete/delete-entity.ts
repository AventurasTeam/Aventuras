import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { HeadTurn } from '@/lib/head-turn'
import { entitiesStore } from '@/lib/stores'
import { deleteTailOf, entityDeleteActions } from '@/lib/world'

import { withTailMetadataLock } from '../story-entries/entry-metadata-lock'
import type { DbCtx } from '../types'
import { commitRowDelete, ROW_DELETE_REJECTION, type RowDeleteResult } from './delete-row'

/**
 * world.md → Delete. Holds the tail's metadata lock like the scene editor, so the drop can't race
 * a scene edit — the locked body re-reads the tail and refuses if it moved since locking.
 */
export function deleteEntityRow(
  branchId: string,
  id: string,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  return withTailMetadataLock(
    branchId,
    ctx,
    (head) => deleteEntityLocked(branchId, id, head, ctx),
    () => {
      logger.warn('action_layer.entity_delete_rejected', {
        branchId,
        id,
        code: ROW_DELETE_REJECTION.inFlight,
        reason: 'tail moved',
      })
      return { status: 'rejected', reason: 'tail moved', code: ROW_DELETE_REJECTION.inFlight }
    },
  )
}

async function deleteEntityLocked(
  branchId: string,
  id: string,
  head: HeadTurn<StoryEntry> | null,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  // Store read, plan build, and commitRowDelete's in-flight check must run with no await between
  // them — a hard-gate run finishing in that gap would commit over a staled snapshot.
  const branchEntities = [...entitiesStore.getEntities().values()].filter(
    (e) => e.branchId === branchId,
  )
  const target = branchEntities.find((e) => e.id === id)
  if (target == null)
    return {
      status: 'rejected',
      reason: `entity ${id} not found`,
      code: ROW_DELETE_REJECTION.notFound,
    }
  const tail = deleteTailOf(head)
  const { actions } = entityDeleteActions({ branchId, target, branchEntities, tail })
  return commitRowDelete('entity', branchId, id, actions, ctx)
}
