import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import type { TxState } from '@/lib/stores'

import { CLOSE_RANGE_INTERMEDIATE_KEY, type CloseRange } from './intermediates'

/**
 * The id of the chapter a close running on `branchId` is writing, from the range its boundary
 * phase parks before any write; null with no close on the branch or before that phase ends.
 */
export function closingChapterId(txState: TxState, branchId: string): string | null {
  for (const run of txState.runs.values()) {
    if (run.kind !== CHAPTER_CLOSE_KIND || run.branchId !== branchId) continue
    const range = run.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] as CloseRange | undefined
    return range?.chapterId ?? null
  }
  return null
}
