import { canEndChapter } from '@/lib/chapters'
import { openRegionSeries } from '@/lib/db'
import {
  CHAPTER_CLOSE_KIND,
  getPipeline,
  preflightSnapshot,
  runPreflight,
  type ChainEnd,
  type PreflightFailedStart,
  type RejectedStart,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL, refused, startCloseChain } from './close-chain'
import type { OwedCloseRun } from './run-owed-close'
import type { DbCtx } from '../types'

/**
 * chapter-close.md → Manual user-triggered close, ending on `endEntryId`: the pick checked, the
 * close pre-flighted before anything starts, a pass included, and the pick written as the first run
 * reserves. Resolves with the chain's end, so a caller can tell a catch-up pass from the close.
 */
export async function startPickedCloseChain(
  branchId: string,
  endEntryId: string,
  ctx: DbCtx,
): Promise<ChainEnd | RejectedStart | PreflightFailedStart> {
  return startCloseChain(branchId, ctx, {
    // C10: the series holds no system or stamped row, and canEndChapter is the only kind rule.
    validate: async (): Promise<RejectedStart | null> => {
      const row = (await openRegionSeries(branchId, ctx)).find((r) => r.id === endEntryId)
      return row && canEndChapter(row) ? null : refused(MANUAL_CLOSE_REFUSAL.invalidEnd)
    },
    preflight: (open) => {
      const failed = runPreflight(getPipeline(CHAPTER_CLOSE_KIND), preflightSnapshot(open.settings))
      // The confirmed pick replaces the owed one though nothing starts; dropped before any await,
      // so no other start's reserve lands in between.
      if (failed) generationStore.clearPendingClose(branchId)
      return failed
    },
    // Fires only on reserve: a start the orchestrator rejects leaves the record as it stood.
    onReserved: () => generationStore.setPendingClose(branchId, { endEntryId }),
  })
}

/** A failed click's entry's Retry: that pick again through the manual start, pre-flighted again. */
export async function runPickedClose(
  branchId: string,
  endEntryId: string,
  ctx: DbCtx,
): Promise<OwedCloseRun> {
  const started = await startPickedCloseChain(branchId, endEntryId, ctx)
  return 'outcome' in started ? started : { outcome: 'ran', end: started }
}
