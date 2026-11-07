import { useEffect } from 'react'

import { useChapterTimeRanges } from '@/hooks/use-chapter-time-ranges'
import type { ChapterTimeRanges } from '@/lib/db'

/** The branch's chapter time ranges, reread each time the route regains focus (mount included). */
export function useTimelineTimeRanges(branchId: string, focused: boolean): ChapterTimeRanges {
  const { ranges, refetch } = useChapterTimeRanges(branchId, { enabled: focused })
  // The client never goes stale and a world-time edit moves no key part: only a refetch sees it.
  useEffect(() => {
    if (focused) void refetch()
  }, [focused, refetch])
  return ranges
}
