import { useCallback } from 'react'

import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  cancelStorySwap,
  refreshEmbeddingStatus,
  resumeStorySwap,
  SwapBusyError,
} from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export type SwapResumeActions = {
  /** Exposed for the engine calls each surface keeps local (reindex, relabel). */
  report: (op: string, error: unknown) => void
  resume: () => void
  cancelSwap: () => void
}

/**
 * Resume/cancel for a pending swap, shared by the Memory panel and the
 * story-open resume prompt. Both reach the same two engine entry points and owe
 * the same reporting contract; each surface keeps its own pre-step (closing a
 * dialog, navigating) at the call site rather than parameterizing it here.
 *
 * Fire-and-forget by design: nothing awaits the outcome, and progress reaches
 * the user through the status store rather than the returned promise.
 */
export function useSwapResumeActions(storyId: string | null): SwapResumeActions {
  const report = useCallback(
    (op: string, error: unknown) => {
      if (error instanceof SwapBusyError) {
        toast.info(t('storySettings:memory.busy'))
        return
      }
      logger.error(`embedder.${op}_failed`, {
        storyId,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error(t('storySettings:memory.actionFailed'))
    },
    [storyId],
  )

  const resume = useCallback(() => {
    if (storyId == null) return
    void resumeStorySwap(storyId, ctx)
      .catch((error: unknown) => report('resume', error))
      .finally(() => void refreshEmbeddingStatus(storyId))
  }, [storyId, report])

  const cancelSwap = useCallback(() => {
    if (storyId == null) return
    void cancelStorySwap(storyId, ctx)
      .then((outcome) => {
        // A swap can cross the finish line between the click and the loop's last
        // cancel poll, in which case the model changed — saying nothing would let
        // the user believe they stopped it.
        if (outcome === 'already-completed') toast.info(t('storySettings:memory.cancelTooLate'))
      })
      .catch((error: unknown) => report('cancel_swap', error))
      .finally(() => void refreshEmbeddingStatus(storyId))
  }, [storyId, report])

  return { report, resume, cancelSwap }
}
