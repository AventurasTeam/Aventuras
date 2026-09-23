import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import type { DbCtx, PipelineAction } from '../types'

export type PlotSaveResult =
  | { status: 'ok'; id: string }
  | { status: 'rejected'; reason: string; code?: string }

export const PLOT_REJECTION = { inFlight: 'in-flight' } as const

type CommitPlotSaveArgs = {
  branchId: string
  /** Null for a create; the id is generated before the actions are built. */
  rowId: string | null
  build: (id: string) => PipelineAction[]
}

const ID_PREFIX = { thread: 'thr', happening: 'hap' } as const

/** One Save = one `action_id`; every refusal and failure is logged with the Save's context. */
export async function commitPlotSave(
  kind: 'thread' | 'happening',
  { branchId, rowId, build }: CommitPlotSaveArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  // generation-pipeline.md → Action rejection — defense in depth: the UI disables first, so
  // this firing means a gating bug or a render race.
  if (generationStore.isUserEditBlocked()) {
    logger.warn(`action_layer.${kind}_save_rejected`, {
      branchId,
      id: rowId,
      code: PLOT_REJECTION.inFlight,
    })
    return { status: 'rejected', reason: 'generation in flight', code: PLOT_REJECTION.inFlight }
  }
  const id = rowId ?? generateId(ID_PREFIX[kind])
  const actions = build(id)
  if (actions.length === 0) return { status: 'ok', id }
  const context = { branchId, id, create: rowId == null, actions: actions.map((a) => a.kind) }
  let result
  try {
    result = await applyDeltaActionGroup(actions, { actionId: generateId('act'), branchId }, ctx)
  } catch (error) {
    logger.error(`action_layer.${kind}_save_failed`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  if (result.status !== 'ok') {
    logger.warn(`action_layer.${kind}_save_rejected`, {
      ...context,
      reason: result.reason,
      code: result.code,
    })
    return result
  }
  return { status: 'ok', id }
}
