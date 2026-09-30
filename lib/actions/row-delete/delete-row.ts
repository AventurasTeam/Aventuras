import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup, DELTA_REJECTION } from '../delta/apply-delta-action'
import { TARGET_NOT_FOUND } from '../delta/registry'
import { ENTITY_DELETE_REJECTION } from '../entities/register'
import { ROW_SAVE_REJECTION } from '../row-save/commit-row-save'
import type { DbCtx, PipelineAction } from '../types'

export const ROW_DELETE_REJECTION = {
  inFlight: ROW_SAVE_REJECTION.inFlight,
  notFound: TARGET_NOT_FOUND,
  leadEntity: ENTITY_DELETE_REJECTION.leadEntity,
  failed: 'failed',
} as const

export type RowDeleteRejectionCode =
  (typeof ROW_DELETE_REJECTION)[keyof typeof ROW_DELETE_REJECTION]

export type RowDeleteResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code: RowDeleteRejectionCode }

// A reversal raised while the delete awaited its lock is what the gate below reports as in-flight.
function rejectionCode(code: string | undefined): RowDeleteRejectionCode {
  switch (code) {
    case DELTA_REJECTION.reversalInProgress:
      return ROW_DELETE_REJECTION.inFlight
    case TARGET_NOT_FOUND:
      return ROW_DELETE_REJECTION.notFound
    case ENTITY_DELETE_REJECTION.leadEntity:
      return ROW_DELETE_REJECTION.leadEntity
    default:
      return ROW_DELETE_REJECTION.failed
  }
}

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
    return { status: 'rejected', reason: result.reason, code: rejectionCode(result.code) }
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
