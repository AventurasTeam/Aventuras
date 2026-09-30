import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import { ROW_SAVE_REJECTION } from '../row-save/commit-row-save'
import type { DbCtx, PipelineAction } from '../types'

export const ROW_DELETE_REJECTION = {
  inFlight: ROW_SAVE_REJECTION.inFlight,
  notFound: 'not-found',
} as const

export type RowDeleteResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code?: string }

export type RowDeleteKind = 'entity' | 'lore' | 'thread' | 'happening'

/** One delete = one `action_id`; refusals and failures log as `action_layer.<kind>_delete_*`. */
export async function commitRowDelete(
  kind: RowDeleteKind,
  branchId: string,
  id: string,
  actions: readonly PipelineAction[],
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  // generation-pipeline.md → Action rejection — defense in depth: the UI disables first.
  if (generationStore.isUserEditBlocked()) {
    logger.warn(`action_layer.${kind}_delete_rejected`, {
      branchId,
      id,
      code: ROW_DELETE_REJECTION.inFlight,
    })
    return {
      status: 'rejected',
      reason: 'generation in flight',
      code: ROW_DELETE_REJECTION.inFlight,
    }
  }
  let result
  try {
    result = await applyDeltaActionGroup(actions, { actionId: generateId('act'), branchId }, ctx)
  } catch (error) {
    logger.error(`action_layer.${kind}_delete_failed`, {
      branchId,
      id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (result.status !== 'ok') {
    logger.warn(`action_layer.${kind}_delete_rejected`, {
      branchId,
      id,
      reason: result.reason,
      code: result.code,
    })
    return result
  }
  return { status: 'ok' }
}

function deleteAction(
  kind: 'lore' | 'thread' | 'happening',
  branchId: string,
  id: string,
): PipelineAction {
  const payload = { branchId, id }
  switch (kind) {
    case 'lore':
      return { kind: 'deleteLore', source: 'user_edit', payload }
    case 'thread':
      return { kind: 'deleteThread', source: 'user_edit', payload }
    case 'happening':
      return { kind: 'deleteHappening', source: 'user_edit', payload }
  }
}

/** A lore, thread or happening row with its cascade (C3). */
export function deleteRow(
  kind: 'lore' | 'thread' | 'happening',
  branchId: string,
  id: string,
  ctx: DbCtx,
): Promise<RowDeleteResult> {
  return commitRowDelete(kind, branchId, id, [deleteAction(kind, branchId, id)], ctx)
}
