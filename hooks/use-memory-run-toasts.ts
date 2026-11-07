import { useEffect } from 'react'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, pipelineEventBus } from '@/lib/pipeline'
import { type DeferredWorkKind } from '@/lib/stores'
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

/**
 * Toasts a pass or close moved to the next Send, and a pass or close that failed outside a Send,
 * on whichever screen is up. Mount once, at the app root: the orchestrator emits each event once.
 */
export function useMemoryRunToasts(): void {
  useEffect(() => {
    const offDeferred = pipelineEventBus.subscribe('run_deferred', (event) => {
      toast.info(t(DEFERRED_WORK_COPY[event.work]))
    })
    // Work that fails under a Send fails the Send, which the reader shows as a system entry instead.
    const offFailed = pipelineEventBus.subscribe('run_complete', (event) => {
      if (event.outcome !== 'failed' || event.beforeTurn) return
      const copy = failedCopy(event.kind)
      if (copy != null) toast.warning(t(copy))
    })
    return () => {
      offDeferred()
      offFailed()
    }
  }, [])
}
