import { useRouter } from 'expo-router'
import { useCallback, useEffect } from 'react'

import { useSwapResumeActions } from '@/hooks/use-swap-resume-actions'
import { currentStoryStore, embedderSwapStore } from '@/lib/stores'

import { SwapResumeDialog } from './swap-resume-dialog'

/**
 * The ONE mount of the resume prompt: a second host rendering off the same marker
 * portals a duplicate of a non-dismissable dialog onto the same body.
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

  useEffect(() => {
    embedderSwapStore.expireDeferredResume(storyId, target)
  }, [storyId, target])

  const open = storyId != null && target != null && !running && deferred !== storyId

  const router = useRouter()
  const { resume, cancelSwap } = useSwapResumeActions(storyId)

  const onResume = useCallback(() => {
    if (storyId == null) return
    embedderSwapStore.clearDeferredResumeFor(storyId)
    // Progress renders in the Memory panel, not wherever the prompt fired —
    // navigate first so that panel is mounted to receive it.
    router.navigate(`/story-settings/${storyId}?tab=memory`)
    resume()
  }, [storyId, router, resume])

  const onCancelSwap = useCallback(() => {
    if (storyId == null) return
    embedderSwapStore.clearDeferredResumeFor(storyId)
    cancelSwap()
  }, [storyId, cancelSwap])

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
