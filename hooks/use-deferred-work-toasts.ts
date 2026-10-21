import { useEffect } from 'react'

import { t } from '@/lib/i18n'
import { pipelineEventBus } from '@/lib/pipeline'
import { deferredWorkKindOf, type DeferredWorkKind } from '@/lib/stores'
import { toast } from '@/lib/toast'

const DEFERRED_WORK_COPY = {
  pass: 'chrome.deferredWork.pass',
  close: 'chrome.deferredWork.close',
} as const satisfies Record<DeferredWorkKind, string>

/**
 * Toasts each pass or close newly moved to the next Send, on whichever screen is up. Mount
 * once, at the app root: the orchestrator emits `run_deferred` once per deferral.
 */
export function useDeferredWorkToasts(): void {
  useEffect(
    () =>
      pipelineEventBus.subscribe('run_deferred', (event) => {
        const kind = deferredWorkKindOf(event.kind)
        if (kind != null) toast.info(t(DEFERRED_WORK_COPY[kind]))
      }),
    [],
  )
}
