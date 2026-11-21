import type { CloseReport } from '@/lib/db'

import { closeFloorOf, closeLedgerOf, requireCloseRange } from './close-intermediates'
import type { CloseLedger } from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/**
 * C4: a close with no ledger reads as one whose tasks called no tool. A re-run's report records
 * `firstLogPosition`, which bounds its group for the review.
 */
export function closeReportOf(
  ledger: CloseLedger | undefined,
  actionId: string,
  firstLogPosition?: number,
): CloseReport {
  const { calls, stopped, noToolCalls } = ledger ?? { calls: [], stopped: [], noToolCalls: true }
  return {
    version: 1,
    actionId,
    calls,
    stopped,
    noToolCalls,
    ...(firstLogPosition === undefined ? {} : { firstLogPosition }),
  }
}

/** chapter-close.md → Review: `close_report` is the close's last write, anchored on its end entry. */
export async function* closeReportPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const range = requireCloseRange(ctx)
  if ('status' in range) return range
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  // Under the gate a re-run's own writes start right above the floor its reversal left.
  const floor = closeFloorOf(ctx.intermediates)
  const closeReport = closeReportOf(
    closeLedgerOf(ctx.intermediates),
    ctx.actionId,
    floor === undefined ? undefined : floor + 1,
  )
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateChapter',
      source: 'chapter_close',
      payload: { branchId: ctx.branchId, id: range.chapterId, patch: { closeReport } },
    },
    entryId: range.endEntryId,
  }
  return { status: 'completed' }
}
