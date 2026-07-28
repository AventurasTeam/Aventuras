import { useRouter } from 'expo-router'
import { useCallback } from 'react'

import {
  cancelStorySwap,
  refreshEmbeddingStatus,
  resumeStorySwap,
  SwapBusyError,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { currentStoryStore, embedderSwapStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { SwapResumeDialog } from './swap-resume-dialog'

const ctx = { db, runInTransaction }

/**
 * The one mount of the resume prompt. It used to render from both the reader and
 * the Memory panel off the same marker, so navigating between them could portal
 * two copies of an identical, non-dismissable dialog onto `document.body`.
 *
 * Keyed on the open story rather than a route, so it follows the user. Story
 * Settings reached by a cold reload has no open story and so no modal — that
 * surface carries its own inline pending-swap row instead.
 */
export function SwapResumeHost() {
  const storyId = currentStoryStore.useCurrentStory((open) => open?.storyId ?? null)
  const target = currentStoryStore.useCurrentStory(
    (open) => open?.settings.embedding_swap_target ?? null,
  )
  const running = embedderSwapStore.useSwap(
    (s) => embedderSwapStore.progressFor(s, storyId) != null,
  )
  const deferred = embedderSwapStore.useSwap((s) => s.resumeDeferredFor)

  const open = storyId != null && target != null && !running && deferred !== storyId

  const router = useRouter()

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

  const onResume = useCallback(() => {
    if (storyId == null) return
    embedderSwapStore.clearDeferredResume()
    // Progress renders in the Memory panel, not wherever the prompt fired —
    // navigate first so that panel is mounted to receive it.
    router.navigate(`/story-settings/${storyId}?tab=memory`)
    void resumeStorySwap(storyId, ctx)
      .catch((error: unknown) => report('resume', error))
      .finally(() => void refreshEmbeddingStatus(storyId))
  }, [storyId, router, report])

  const onCancelSwap = useCallback(() => {
    if (storyId == null) return
    embedderSwapStore.clearDeferredResume()
    void cancelStorySwap(storyId, ctx)
      .then((outcome) => {
        // The swap can cross the finish line between the click and the loop's
        // last cancel poll; reporting nothing would imply it was stopped.
        if (outcome === 'already-completed') toast.info(t('storySettings:memory.cancelTooLate'))
      })
      .catch((error: unknown) => report('cancel_swap', error))
      .finally(() => void refreshEmbeddingStatus(storyId))
  }, [storyId, report])

  const onLater = useCallback(() => {
    if (storyId != null) embedderSwapStore.deferResume(storyId)
  }, [storyId])

  if (storyId == null) return null

  return (
    <SwapResumeDialog
      open={open}
      targetModelName={target ?? ''}
      onResume={onResume}
      onCancelSwap={onCancelSwap}
      onLater={onLater}
    />
  )
}
