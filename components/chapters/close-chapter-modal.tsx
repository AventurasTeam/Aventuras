import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactElement } from 'react'

import { worldTimeLabel } from '@/components/reader/chapter-time-range'
import { useStoryGenerationGate } from '@/components/story-settings/generation-run'
import { useBranchTailId } from '@/hooks/use-branch-tail-id'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { resolveCalendar, type CalendarFrame } from '@/lib/calendar'
import { canEndChapter, tokensThrough } from '@/lib/chapters'
import { db, openRegionSeries, type OpenRegionRow } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { formatEntryRef, readOpenRegionTimes } from '@/lib/entry-refs'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  generationStore,
  type CloseModalRequest,
} from '@/lib/stores'

import { CloseChapterModalView, type CloseModalRow } from './close-chapter-modal-view'

const NO_TIMES: ReadonlyMap<string, number> = new Map()

// Logs from the shared fetch, since every mounted observer receives the same error. Without the
// series there is nothing to confirm; without the times the rows only lose their labels.
async function readLogged<T>(
  branchId: string,
  read: 'series' | 'times',
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    logger[read === 'series' ? 'error' : 'warn']('app.close_modal_read_failed', {
      branchId,
      read,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * chapter-timeline.md → Chapter-close modal, connected: mounted only while a request holds the open
 * branch, so its reads run only while the modal is up.
 */
export function CloseChapterModal({
  request,
  onConfirm,
}: {
  request: CloseModalRequest
  onConfirm: (branchId: string, endEntryId: string) => void
}): ReactElement {
  const { branchId } = request
  const storyId = currentStoryStore.useCurrentStory((open) => open?.storyId)
  const calendarSystemId = currentStoryStore.useCurrentStory(
    (open) => open?.definition.calendarSystemId,
  )
  const origin = currentStoryStore.useCurrentStory((open) => open?.definition.worldTimeOrigin)
  const frame = useMemo(
    (): CalendarFrame | null =>
      calendarSystemId == null || origin == null
        ? null
        : { calendar: resolveCalendar(calendarSystemId), origin },
    [calendarSystemId, origin],
  )
  const endedChapterNumber = chaptersStore.useChapters((rows) => {
    const latest = chaptersStore.selectLatest(rows)
    return latest?.branchId === branchId ? latest.sequenceNumber : null
  })
  const { gateReason } = useStoryGenerationGate(storyId, branchId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const tailId = useBranchTailId(branchId)
  const { index } = useEntryIndex(branchId)
  const { data: series } = useQuery({
    queryKey: ['close-modal-series', branchId, settleCount, tailId],
    queryFn: () => readLogged(branchId, 'series', () => openRegionSeries(branchId, { db })),
    // A settle re-reads under a new key; the rows stay up meanwhile. The body's branch is fixed.
    placeholderData: keepPreviousData,
  })
  // C15: a world-time edit moves neither key part and the client never goes stale, so the read
  // runs again each time the modal opens.
  const { data: times = NO_TIMES } = useQuery({
    queryKey: ['close-modal-times', branchId, settleCount, tailId],
    queryFn: () => readLogged(branchId, 'times', () => readOpenRegionTimes(branchId, db)),
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  })
  const [picked, setPicked] = useState<string | null>(null)

  const { start, replies } = useMemo(() => {
    const rowOf = (entry: OpenRegionRow): CloseModalRow => {
      const seconds = times.get(entry.id)
      return {
        id: entry.id,
        ref: formatEntryRef(entry.position),
        excerpt: index.get(entry.id)?.excerpt ?? '',
        time: seconds == null ? null : worldTimeLabel(seconds, frame),
      }
    }
    const first = series?.[0]
    return {
      start: first == null ? null : { ...rowOf(first), endedChapterNumber },
      replies: (series ?? []).filter(canEndChapter).reverse().map(rowOf),
    }
  }, [series, times, index, frame, endedChapterNumber])

  const listed = (id: string | null | undefined): id is string =>
    id != null && replies.some((row) => row.id === id)
  const latestId = replies[0]?.id ?? null
  const selectedId = listed(picked)
    ? picked
    : listed(request.endEntryId)
      ? request.endEntryId
      : latestId

  return (
    <CloseChapterModalView
      open
      start={start}
      replies={replies}
      selectedId={selectedId}
      tokensInRange={
        series == null || selectedId == null ? 0 : (tokensThrough(series, selectedId) ?? 0)
      }
      disabledReason={gateReason}
      onSelect={setPicked}
      onConfirm={() => {
        if (selectedId != null) onConfirm(branchId, selectedId)
      }}
      onCancel={chapterOverlaysStore.closeCloseModal}
    />
  )
}
