import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import type { DbCtx, PipelineAction } from '../types'

export type RowSaveResult =
  | { status: 'ok'; id: string }
  | { status: 'rejected'; reason: string; code?: string }

export const ROW_SAVE_REJECTION = { inFlight: 'in-flight' } as const

export type RowSaveKind = 'thread' | 'happening' | 'entity'

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
  const actions = build(id)
  if (actions.length === 0) {
    if (rowId == null) throw new Error('commitRowSave: a create built no actions')
    return { status: 'ok', id }
  }
  const context = { branchId, id, create: rowId == null, actions: actions.map((a) => a.kind) }
  let result
  try {
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
    return result
  }
  return { status: 'ok', id }
}
