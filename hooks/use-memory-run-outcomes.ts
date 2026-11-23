import { useEffect } from 'react'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { readLatestCloseReport } from '@/lib/history'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, pipelineEventBus } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  type CloseResult,
  type DeferredWorkKind,
  type StoreChapter,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

const DEFERRED_WORK_COPY = {
  pass: 'chrome.deferredWork.pass',
  close: 'chrome.deferredWork.close',
} as const satisfies Record<DeferredWorkKind, string>

function failedCopy(
  kind: string,
): 'chrome.memoryUpdateFailed' | 'chrome.chapterCloseFailed' | null {
  if (kind === PERIODIC_CLASSIFIER_KIND) return 'chrome.memoryUpdateFailed'
  if (kind === CHAPTER_CLOSE_KIND) return 'chrome.chapterCloseFailed'
  return null
}

function latestStoreChapter(branchId: string): StoreChapter | undefined {
  return chaptersStore.getLoadedBranch() === branchId
    ? chaptersStore.getLatest(branchId)
    : undefined
}

// `run_complete` names no chapter or branch: the open branch's latest report must carry its
// actionId; a failed read falls back to the store's latest chapter, unmatched, count 0.
async function committedClose(actionId: string, rerun: boolean): Promise<CloseResult | null> {
  const branchId = currentStoryStore.getCurrentStory()?.branchId
  if (branchId == null) return null
  // Read before the await, so a read that lands after a reopen holds a result for the earlier open.
  const openSeq = currentStoryStore.getOpenSeq()
  try {
    const latest = await readLatestCloseReport(db, branchId)
    const report = latest?.report
    if (latest == null || report == null || report.actionId !== actionId) return null
    return {
      branchId,
      openSeq,
      chapterId: latest.chapterId,
      actionId,
      rerun,
      stoppedTasks: report.stopped.length,
    }
  } catch (error) {
    logger.warn('app.close_result_read_failed', {
      branchId,
      actionId,
      error: error instanceof Error ? error.message : String(error),
    })
    const chapter = latestStoreChapter(branchId)
    return chapter == null
      ? null
      : { branchId, openSeq, chapterId: chapter.id, actionId, rerun, stoppedTasks: 0 }
  }
}

/**
 * Toasts a pass or close deferred to the next Send or failed outside one; holds a committed close
 * or re-run for the banner. Mount once at the app root: each event is emitted once.
 */
export function useMemoryRunOutcomes(): void {
  useEffect(() => {
    let mounted = true
    const offDeferred = pipelineEventBus.subscribe('run_deferred', (event) => {
      toast.info(t(DEFERRED_WORK_COPY[event.work]))
    })
    // Work that fails under a Send fails the Send, which the reader shows as a system entry
    // instead; a re-run's failure is its host's notice, since the close it replaces stands.
    const offFailed = pipelineEventBus.subscribe('run_complete', (event) => {
      if (event.outcome !== 'failed' || event.beforeTurn || event.rerun === true) return
      const copy = failedCopy(event.kind)
      if (copy != null) toast.warning(t(copy))
    })
    const offCommitted = pipelineEventBus.subscribe('run_complete', (event) => {
      if (event.kind !== CHAPTER_CLOSE_KIND || event.outcome !== 'completed') return
      void committedClose(event.actionId, event.rerun === true).then((result) => {
        if (mounted && result != null) chapterOverlaysStore.showCloseResult(result)
      })
    })
    return () => {
      mounted = false
      offDeferred()
      offFailed()
      offCommitted()
    }
  }, [])
}
