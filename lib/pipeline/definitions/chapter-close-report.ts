import type { CloseReport } from '@/lib/db'

import {
  CLOSE_LEDGER_INTERMEDIATE_KEY,
  CLOSE_RANGE_INTERMEDIATE_KEY,
  type CloseLedger,
  type CloseRange,
} from './intermediates'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/** C4: a close with no ledger reads as one whose tasks called no tool. */
export function closeReportOf(ledger: CloseLedger | undefined, actionId: string): CloseReport {
  const { calls, stopped, noToolCalls } = ledger ?? { calls: [], stopped: [], noToolCalls: true }
  return { version: 1, actionId, calls, stopped, noToolCalls }
}

/** chapter-close.md → Review: `close_report` is the close's last write, anchored on its end entry. */
export async function* closeReportPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  const range = ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] as CloseRange | undefined
  if (!range)
    return {
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    }
  if (ctx.abortSignal.aborted) return { status: 'aborted' }
  const closeReport = closeReportOf(
    ctx.intermediates[CLOSE_LEDGER_INTERMEDIATE_KEY] as CloseLedger | undefined,
    ctx.actionId,
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
