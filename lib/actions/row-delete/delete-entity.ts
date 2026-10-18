import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { HeadTurn } from '@/lib/head-turn'
import { entitiesStore } from '@/lib/stores'
import { deleteTailOf, entityDeleteActions } from '@/lib/world'

import { withTailMetadataLock } from '../story-entries/entry-metadata-lock'
import type { DbCtx } from '../types'
import {
  commitRowDeleteBuilt,
  ROW_DELETE_REJECTION,
  rowDeleteGateRefusal,
  type RowDeleteResult,
} from './delete-row'

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

function deleteEntityLocked(
  branchId: string,
  id: string,
  head: HeadTurn<StoryEntry> | null,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  const tail = deleteTailOf(head)
  // cadence.md → Concurrency: built from the stores under the branch lock's shared hold, so a
  // pass's write to a member can't land between this read and the commit.
  return commitRowDeleteBuilt(
    'entity',
    branchId,
    id,
    () => {
      const gated = rowDeleteGateRefusal()
      if (gated) return gated
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
      return {
        status: 'ok',
        actions: entityDeleteActions({ branchId, target, branchEntities, tail }).actions,
      }
    },
    ctx,
  )
}
