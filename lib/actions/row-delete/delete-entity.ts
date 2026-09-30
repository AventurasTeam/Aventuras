import { logger } from '@/lib/diagnostics'
import { entitiesStore } from '@/lib/stores'
import { entityDeleteActions, type DeleteTail } from '@/lib/world'

import { withKeyLock } from '../delta/key-lock'
import { ENTITY_DELETE_REJECTION } from '../entities/register'
import { loadHeadTurn } from '../story-entries/head-turn'
import { entryMetadataLockKey } from '../story-entries/world-time'
import type { DbCtx } from '../types'
import { commitRowDelete, ROW_DELETE_REJECTION, type RowDeleteResult } from './delete-row'

export const ENTITY_DELETE_CODES = { ...ROW_DELETE_REJECTION, ...ENTITY_DELETE_REJECTION } as const

/**
 * world.md → Delete. Holds the tail's metadata lock like the scene editor, so the drop can't race
 * a scene edit — the locked body re-reads the tail and refuses if it moved since locking.
 */
export async function deleteEntityRow(
  branchId: string,
  id: string,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  const lockedTail = (await loadHeadTurn(branchId, ctx))?.tail.id ?? null
  const run = () => deleteEntityLocked(branchId, id, lockedTail, ctx)
  return lockedTail == null ? run() : withKeyLock(entryMetadataLockKey(branchId, lockedTail), run)
}

async function deleteEntityLocked(
  branchId: string,
  id: string,
  lockedTail: string | null,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  const head = await loadHeadTurn(branchId, ctx)
  if ((head?.tail.id ?? null) !== lockedTail) {
    logger.warn('action_layer.entity_delete_rejected', {
      branchId,
      id,
      code: ROW_DELETE_REJECTION.inFlight,
      reason: 'tail moved',
    })
    return { status: 'rejected', reason: 'tail moved', code: ROW_DELETE_REJECTION.inFlight }
  }
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
  const metadata = head?.tail.metadata
  const tail: DeleteTail | null =
    head == null || metadata == null
      ? null
      : {
          id: head.tail.id,
          sceneEntities: metadata.sceneEntities,
          currentLocationId: metadata.currentLocationId,
        }
  const { actions } = entityDeleteActions({ branchId, target, branchEntities, tail })
  return commitRowDelete('entity', branchId, id, actions, ctx)
}
