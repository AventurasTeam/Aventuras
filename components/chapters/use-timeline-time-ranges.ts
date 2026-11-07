import { useEffect } from 'react'

import { useBranchTailId } from '@/hooks/use-branch-tail-id'
import { useChapterTimeRanges } from '@/hooks/use-chapter-time-ranges'
import type { ChapterTimeRanges } from '@/lib/db'

/** The branch's chapter time ranges, reread on each focus (mount included) and key move while focused. */
export function useTimelineTimeRanges(branchId: string, focused: boolean): ChapterTimeRanges {
  const { ranges, refetch } = useChapterTimeRanges(branchId, { enabled: focused })
  const tailId = useBranchTailId(branchId)
  // The client never goes stale and a world-time edit moves no key part: only a refetch sees it,
  // also when the branch or tail moves onto a cached key.
  useEffect(() => {
    if (focused) void refetch()
  }, [focused, branchId, tailId, refetch])
  return ranges
}
