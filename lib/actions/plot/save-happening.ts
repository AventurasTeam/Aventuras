import type { Happening } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { happeningActions, type HappeningDraft, type HappeningLinks } from '@/lib/plot'
import { generationStore } from '@/lib/stores'

import { applyDeltaActionGroup } from '../delta/apply-delta-action'
import type { DbCtx } from '../types'
import { PLOT_REJECTION, type PlotSaveResult } from './save-thread'

type SaveHappeningArgs = {
  branchId: string
  row: Happening | null
  links: HappeningLinks
  draft: HappeningDraft
}

/** Row plus involvement and awareness changes as one `action_id`; undo reverses the whole Save. */
export async function saveHappening(
  { branchId, row, links, draft }: SaveHappeningArgs,
  ctx: DbCtx,
): Promise<PlotSaveResult> {
  if (generationStore.isUserEditBlocked()) {
    logger.debug('action_layer.happening_save_rejected', {
      branchId,
      id: row?.id ?? null,
      code: PLOT_REJECTION.inFlight,
    })
    return { status: 'rejected', reason: 'generation in flight', code: PLOT_REJECTION.inFlight }
  }
  const id = row?.id ?? generateId('hap')
  const actions = happeningActions({
    branchId,
    row,
    links,
    draft,
    id,
    now: Date.now(),
    newId: generateId,
  })
  if (actions.length === 0) return { status: 'ok', id }
  const result = await applyDeltaActionGroup(
    actions,
    { actionId: generateId('act'), branchId },
    ctx,
  )
  if (result.status !== 'ok') {
    logger.warn('action_layer.happening_save_rejected', {
      branchId,
      id,
      reason: result.reason,
      code: result.code,
    })
    return result
  }
  return { status: 'ok', id }
}
