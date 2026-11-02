import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { chapterProgressOf, type ChapterProgress } from '@/lib/chapters'
import { db, openRegionSeries, type OpenRegionRow } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { currentStoryStore, generationStore } from '@/lib/stores'

import { useBranchTailId } from './use-branch-tail-id'

type ShownRead = { branchId: string; series: readonly OpenRegionRow[] }

const EMPTY_SERIES: readonly OpenRegionRow[] = []

/**
 * Progress of `storyId`'s open region, zeros with `canClose` false when that story isn't the open
 * one. The scope argument is required because the open story is global and nothing clears it on
 * navigation: an unscoped read would show the last-opened story's progress.
 * settleCount and the tail cover every write to a column the series reads: a new write path must
 * settle a run or reversal, or move the tail.
 */
export function useChapterProgress(storyId: string | null | undefined): ChapterProgress {
  const branchId = currentStoryStore.useCurrentStory((open) =>
    open != null && open.storyId === storyId ? open.branchId : null,
  )
  const threshold = currentStoryStore.useCurrentStory((open) =>
    open != null && open.storyId === storyId ? open.settings.chapterTokenThreshold : 0,
  )
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const tailId = useBranchTailId(branchId)

  const { data, error } = useQuery({
    queryKey: ['chapter-progress', branchId, settleCount, tailId],
    queryFn: branchId == null ? skipToken : () => openRegionSeries(branchId, { db }),
    // Local DB read, not a flaky network call — a failure is worth logging, not retrying.
    retry: false,
    gcTime: 30_000,
    // A local read: TanStack's default pauses it while the browser reports no network.
    networkMode: 'always',
  })

  // data is undefined while a new key loads and after a failed read; hold the last read, tagged by
  // branch so a switch never shows another branch's number.
  const [lastRead, setLastRead] = useState<ShownRead | null>(null)
  let shown = lastRead?.branchId === branchId ? lastRead : null
  if (branchId != null && data != null && data !== shown?.series) {
    shown = { branchId, series: data }
  }
  if (shown !== lastRead) setLastRead(shown)

  useEffect(() => {
    if (error == null) return
    logger.warn('app.chapter_progress_read_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
  }, [error, branchId])

  return useMemo(
    () => chapterProgressOf(shown?.series ?? EMPTY_SERIES, threshold),
    [shown, threshold],
  )
}
