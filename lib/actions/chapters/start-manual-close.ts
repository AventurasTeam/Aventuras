import { canEndChapter } from '@/lib/chapters'
import { openRegionSeries } from '@/lib/db'
import {
  CHAPTER_CLOSE_KIND,
  getPipeline,
  preflightSnapshot,
  runPreflight,
  type PreflightFailedStart,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, refused, startCloseChain } from './close-chain'
import type { DbCtx } from '../types'

export { MANUAL_CLOSE_REFUSAL, type ManualCloseRefusal } from './close-chain'

/**
 * chapter-close.md → Manual user-triggered close, ending on `endEntryId`. C14: a pass first while
 * entries are unprocessed; the pick is written as the first run reserves; resolves with the
 * chain's last run. The close's pre-flight runs before anything starts, a pass included.
 */
export async function startManualClose(
  branchId: string,
  endEntryId: string,
  ctx: DbCtx,
): Promise<TxResult | RejectedStart | PreflightFailedStart> {
  const end = await startCloseChain(branchId, ctx, {
    // C10: the series holds no system or stamped row, and canEndChapter is the only kind rule.
    validate: async (): Promise<RejectedStart | null> => {
      const row = (await openRegionSeries(branchId, ctx)).find((r) => r.id === endEntryId)
      return row && canEndChapter(row) ? null : refused(MANUAL_CLOSE_REFUSAL.invalidEnd)
    },
    preflight: (open) =>
      runPreflight(getPipeline(CHAPTER_CLOSE_KIND), preflightSnapshot(open.settings)),
    // Fires only on reserve: a start the orchestrator rejects leaves the record as it stood.
    onReserved: () => generationStore.setPendingClose(branchId, { endEntryId }),
  })
  return 'outcome' in end ? end : end.result
}
