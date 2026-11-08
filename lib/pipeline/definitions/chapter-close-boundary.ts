import { canEndChapter, fallbackChapterEnd } from '@/lib/chapters'
import { openRegionSeries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { setCloseRange } from './close-intermediates'
import { CLOSE_PHASE } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

function refuse(detail: string): PhaseResult {
  return {
    status: 'failed',
    error: { kind: 'phase-logic', detail, phaseName: CLOSE_PHASE.boundary },
  }
}

// Dropped so the next Send owes nothing on it; a threshold close is still read fresh by closeOwed.
function refuseStalePick(branchId: string, detail: string): PhaseResult {
  generationStore.clearPendingClose(branchId)
  return refuse(detail)
}

function parkRange(ctx: PhaseContext, startEntryId: string, endEntryId: string): PhaseResult {
  setCloseRange(ctx.intermediates, { chapterId: generateId('chap'), startEntryId, endEntryId })
  return { status: 'completed' }
}

/**
 * C2 → boundary: the branch's manual pick, else the no-model fallback (chapter-close.md → Phase 1),
 * into the run's range. The run holds the gate here, so this is the check that counts.
 */
export async function* closeBoundaryPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const series = await openRegionSeries(ctx.branchId, ctx)
  // Read past the await, so the pick checked is the pick dropped.
  const pick = generationStore.getTxState().pendingClose.get(ctx.branchId)
  if (pick) {
    const end = series.find((row) => row.id === pick.endEntryId)
    if (!end)
      return refuseStalePick(
        ctx.branchId,
        `chapter-close: end entry ${pick.endEntryId} is not in the open region`,
      )
    if (!canEndChapter(end))
      return refuseStalePick(
        ctx.branchId,
        `chapter-close: a chapter can't end on ${end.kind} entry ${end.id}`,
      )
    return parkRange(ctx, series[0].id, end.id)
  }
  // closeOwed owes no close to a region with no reply (C10), so this refusal is a backstop.
  const end = fallbackChapterEnd(series)
  if (!end)
    return refuse(`chapter-close: branch ${ctx.branchId} has no open-region reply to end on`)
  return parkRange(ctx, series[0].id, end.id)
}
