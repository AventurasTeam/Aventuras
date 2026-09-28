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
 * world.md → Delete: the entity with its link rows and vectors, every other entity's ref to it, and
 * the tail scene's mention, under one `action_id`. Holds the tail's metadata lock as the scene
 * editor does, so the scene drop can't race a scene edit.
 */
export async function deleteEntityRow(
  branchId: string,
  id: string,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  const head = await loadHeadTurn(branchId, ctx)
  const run = () => deleteEntityLocked(branchId, id, ctx)
  return head == null ? run() : withKeyLock(entryMetadataLockKey(branchId, head.tail.id), run)
}

async function deleteEntityLocked(
  branchId: string,
  id: string,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
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
  const head = await loadHeadTurn(branchId, ctx)
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
