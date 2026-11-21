import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import type { TxState } from '@/lib/stores'

import { closeRangeOf } from './close-intermediates'

/**
 * The id of the chapter a close running on `branchId` is writing, from the range its boundary
 * phase parks before any write; null with no close on the branch, under a re-run, which writes no
 * new chapter, or before that phase ends.
 */
export function closingChapterId(txState: TxState, branchId: string): string | null {
  for (const run of txState.runs.values()) {
    if (run.kind !== CHAPTER_CLOSE_KIND || run.branchId !== branchId) continue
    if (run.interruptible === 'rerun') continue
    return closeRangeOf(run.intermediates)?.chapterId ?? null
  }
  return null
}
