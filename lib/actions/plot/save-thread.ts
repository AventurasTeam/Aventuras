import type { Thread } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { threadActions, type ThreadDraft } from '@/lib/plot'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import type { DbCtx } from '../types'

export type PlotSaveResult =
  | { status: 'ok'; id: string }
  | { status: 'rejected'; reason: string; code?: string }

export const PLOT_REJECTION = { inFlight: 'in-flight' } as const

type SaveThreadArgs = { branchId: string; row: Thread | null; draft: ThreadDraft }

/** One Save = one `action_id`: a create, or the changed columns of an update. */
export async function saveThread(
  { branchId, row, draft }: SaveThreadArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  // The UI disables while generation is in flight; the arm refuses too. Routine, so debug.
  if (generationStore.isUserEditBlocked()) {
    logger.debug('action_layer.thread_save_rejected', {
      branchId,
      id: row?.id ?? null,
      code: PLOT_REJECTION.inFlight,
    })
    return { status: 'rejected', reason: 'generation in flight', code: PLOT_REJECTION.inFlight }
  }
  const id = row?.id ?? generateId('thr')
  const actions = threadActions({ branchId, row, draft, id, now: Date.now() })
  if (actions.length === 0) return { status: 'ok', id }
  const result = await applyDeltaActionGroup(
    actions,
    { actionId: generateId('act'), branchId },
    ctx,
  )
  if (result.status !== 'ok') {
    logger.warn('action_layer.thread_save_rejected', {
      branchId,
      id,
      reason: result.reason,
      code: result.code,
    })
    return result
  }
  return { status: 'ok', id }
}
