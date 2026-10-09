import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'
import { PARENT_CHAIN_BROKEN, PARENT_CYCLE } from '@/lib/world'

import { applyDeltaActionGroup, DELTA_REJECTION } from '../delta/apply-delta-action'
import { TARGET_NOT_FOUND } from '../delta/registry'
import type { DbCtx, PipelineAction } from '../types'

export const ROW_SAVE_REJECTION = {
  inFlight: 'in-flight',
  parentCycle: PARENT_CYCLE,
  parentChainBroken: PARENT_CHAIN_BROKEN,
  notFound: TARGET_NOT_FOUND,
  failed: 'failed',
} as const

export type RowSaveRejectionCode = (typeof ROW_SAVE_REJECTION)[keyof typeof ROW_SAVE_REJECTION]

export type RowSaveResult =
  | { status: 'ok'; id: string }
  | { status: 'rejected'; reason: string; code: RowSaveRejectionCode }

// A reversal raised while the save awaited its locks is what the gate below reports as in-flight.
function rejectionCode(code: string | undefined): RowSaveRejectionCode {
  switch (code) {
    case DELTA_REJECTION.reversalInProgress:
      return ROW_SAVE_REJECTION.inFlight
    case PARENT_CYCLE:
      return ROW_SAVE_REJECTION.parentCycle
    case PARENT_CHAIN_BROKEN:
      return ROW_SAVE_REJECTION.parentChainBroken
    case TARGET_NOT_FOUND:
      return ROW_SAVE_REJECTION.notFound
    default:
      return ROW_SAVE_REJECTION.failed
  }
}

export type RowSaveKind = 'thread' | 'happening' | 'entity' | 'lore'

type CommitRowSaveArgs = {
  branchId: string
  /** Null for a create; the id is generated before the actions are built. */
  rowId: string | null
  idPrefix: string
  build: (id: string) => PipelineAction[]
}

/** One Save = one `action_id`; refusals and failures log as `action_layer.<rowKind>_save_*`. */
export async function commitRowSave(
  rowKind: RowSaveKind,
  { branchId, rowId, idPrefix, build }: CommitRowSaveArgs,
  ctx: DbCtx,
): Promise<RowSaveResult> {
  // generation-pipeline.md → Action rejection — defense in depth: the UI disables first, so
  // this firing means a gating bug or a render race.
  if (generationStore.isUserEditBlocked()) {
    logger.warn(`action_layer.${rowKind}_save_rejected`, {
      branchId,
      id: rowId,
      code: ROW_SAVE_REJECTION.inFlight,
    })
    return { status: 'rejected', reason: 'generation in flight', code: ROW_SAVE_REJECTION.inFlight }
  }
  const id = rowId ?? generateId(idPrefix)
  const context: Record<string, unknown> = { branchId, id, create: rowId == null }
  let result
  try {
    const actions = build(id)
    if (actions.length === 0) {
      if (rowId == null) throw new Error('commitRowSave: a create built no actions')
      return { status: 'ok', id }
    }
    context.actions = actions.map((a) => a.kind)
    result = await applyDeltaActionGroup(actions, { actionId: generateId('act'), branchId }, ctx)
  } catch (error) {
    logger.error(`action_layer.${rowKind}_save_failed`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (result.status !== 'ok') {
    logger.warn(`action_layer.${rowKind}_save_rejected`, {
      ...context,
      reason: result.reason,
      code: result.code,
    })
    return { status: 'rejected', reason: result.reason, code: rejectionCode(result.code) }
  }
  return { status: 'ok', id }
}
