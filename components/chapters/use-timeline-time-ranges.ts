import { useEffect } from 'react'

import { useChapterTimeRanges } from '@/hooks/use-chapter-time-ranges'
import type { ChapterTimeRanges } from '@/lib/db'

/** The branch's chapter time ranges, reread on each focus (mount included) and key move while focused. */
export function useTimelineTimeRanges(branchId: string, focused: boolean): ChapterTimeRanges {
  const { ranges, refetch, tailId } = useChapterTimeRanges(branchId, { enabled: focused })
  // The client never goes stale and a world-time edit moves no key part: only a refetch sees it,
  // also when the branch or tail moves onto a cached key.
  useEffect(() => {
    if (focused) void refetch()
  }, [focused, branchId, tailId, refetch])
  return ranges
}
