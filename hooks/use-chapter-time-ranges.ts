import { useQuery } from '@tanstack/react-query'

import { db, readChapterTimeRanges, type ChapterTimeRanges } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

import { useBranchTailId } from './use-branch-tail-id'

const NO_RANGES: ChapterTimeRanges = new Map()

// Logs from the shared fetch, since every mounted observer receives the same error.
async function readRanges(branchId: string): Promise<ChapterTimeRanges> {
  try {
    return await readChapterTimeRanges(branchId, db)
  } catch (error) {
    logger.warn('app.chapter_time_ranges_read_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * World-time ranges by chapter. The key (settleCount, tail) covers new rows, not world-time edits,
 * and the query client never goes stale: a surface calls `refetch()` each open, even if disabled.
 * `tailId` is the key's tail, for a surface that also rereads when it moves.
 */
export function useChapterTimeRanges(
  branchId: string,
  options: { enabled: boolean },
): { ranges: ChapterTimeRanges; refetch: () => Promise<unknown>; tailId: string | null } {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const tailId = useBranchTailId(branchId)

  const { data, refetch } = useQuery({
    queryKey: ['chapter-time-ranges', branchId, settleCount, tailId],
    queryFn: () => readRanges(branchId),
    enabled: options.enabled,
    // A settle under an open popover moves the key; its rows keep their lines, but only on this
    // branch, since branch copies share chapter ids.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === branchId ? previous : undefined,
  })

  return { ranges: data ?? NO_RANGES, refetch, tailId }
}
