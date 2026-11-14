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
  return chaptersStore.getLoadedBranch() === branchId ? chaptersStore.getLatest() : undefined
}

/** `run_complete` names no chapter/branch: the open branch's latest report must match actionId. */
async function committedClose(actionId: string): Promise<CloseResult | null> {
  const branchId = currentStoryStore.getCurrentStory()?.branchId
  if (branchId == null) return null
  try {
    const latest = await readLatestCloseReport(db, branchId)
    const report = latest?.report
    if (latest == null || report == null || report.actionId !== actionId) return null
    return { branchId, chapterId: latest.chapterId, stoppedTasks: report.stopped.length }
  } catch (error) {
    logger.warn('app.close_result_read_failed', {
      branchId,
      actionId,
      error: error instanceof Error ? error.message : String(error),
    })
    const chapter = latestStoreChapter(branchId)
    return chapter == null ? null : { branchId, chapterId: chapter.id, stoppedTasks: 0 }
  }
}

/**
 * Toasts a pass or close moved to the next Send, and a pass or close that failed outside a Send;
 * holds a committed close for the in-story banner. Mount once, at the app root: the orchestrator
 * emits each event once.
 */
export function useMemoryRunToasts(): void {
  useEffect(() => {
    let mounted = true
    const offDeferred = pipelineEventBus.subscribe('run_deferred', (event) => {
      toast.info(t(DEFERRED_WORK_COPY[event.work]))
    })
    // Work that fails under a Send fails the Send, which the reader shows as a system entry instead.
    const offFailed = pipelineEventBus.subscribe('run_complete', (event) => {
      if (event.outcome !== 'failed' || event.beforeTurn) return
      const copy = failedCopy(event.kind)
      if (copy != null) toast.warning(t(copy))
    })
    const offCommitted = pipelineEventBus.subscribe('run_complete', (event) => {
      if (event.kind !== CHAPTER_CLOSE_KIND || event.outcome !== 'completed') return
      void committedClose(event.actionId).then((result) => {
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
