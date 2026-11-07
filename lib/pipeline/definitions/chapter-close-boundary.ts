import { canEndChapter } from '@/lib/chapters'
import { openRegionSeries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { CLOSE_PHASE, CLOSE_RANGE_INTERMEDIATE_KEY, type CloseRange } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

function refuse(detail: string): PhaseResult {
  return {
    status: 'failed',
    error: { kind: 'phase-logic', detail, phaseName: CLOSE_PHASE.boundary },
  }
}

/**
 * C2 → boundary: resolves the branch's pending close into the run's range. The run holds the gate
 * here, so this is the check that counts; the manual start's own read sits outside it.
 */
export async function* closeBoundaryPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const pending = generationStore.getTxState().pendingClose.get(ctx.branchId)
  if (!pending) return refuse(`chapter-close: no close is pending on branch ${ctx.branchId}`)
  const { endEntryId } = pending
  const series = await openRegionSeries(ctx.branchId, ctx)
  const end = series.find((row) => row.id === endEntryId)
  if (!end) return refuse(`chapter-close: end entry ${endEntryId} is not in the open region`)
  if (!canEndChapter(end))
    return refuse(`chapter-close: a chapter can't end on ${end.kind} entry ${endEntryId}`)
  const range: CloseRange = {
    chapterId: generateId('chap'),
    startEntryId: series[0].id,
    endEntryId,
  }
  ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] = range
  return { status: 'completed' }
}
