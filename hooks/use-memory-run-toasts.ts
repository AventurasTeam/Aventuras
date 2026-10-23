import { useEffect } from 'react'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import { pipelineEventBus } from '@/lib/pipeline'
import { type DeferredWorkKind } from '@/lib/stores'
import { toast } from '@/lib/toast'

const DEFERRED_WORK_COPY = {
  pass: 'chrome.deferredWork.pass',
  close: 'chrome.deferredWork.close',
} as const satisfies Record<DeferredWorkKind, string>

/**
 * Toasts a pass or close moved to the next Send, and a pass that failed outside a Send, on
 * whichever screen is up. Mount once, at the app root: the orchestrator emits each event once.
 */
export function useMemoryRunToasts(): void {
  useEffect(() => {
    const offDeferred = pipelineEventBus.subscribe('run_deferred', (event) => {
      toast.info(t(DEFERRED_WORK_COPY[event.work]))
    })
    // A pass that fails at Send fails the Send, which the reader shows as a system entry instead.
    const offFailed = pipelineEventBus.subscribe('run_complete', (event) => {
      if (
        event.kind === PERIODIC_CLASSIFIER_KIND &&
        event.outcome === 'failed' &&
        !event.beforeTurn
      )
        toast.warning(t('chrome.memoryUpdateFailed'))
    })
    return () => {
      offDeferred()
      offFailed()
    }
  }, [])
}
