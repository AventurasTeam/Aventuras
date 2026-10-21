import {
  useIsFocused,
  useNavigation,
  useNavigationState,
  usePreventRemove,
  useRoute,
} from '@react-navigation/native'
import { createElement, useCallback, useEffect, useState, type JSX } from 'react'

import { StoryLeaveDialog } from '@/components/compounds/story-leave-dialog'
import { logger } from '@/lib/diagnostics'
import { cancelStoryRuns, generationStore, isStoryBusy, type TxState } from '@/lib/stores'

// Root-stack route names of the in-story surfaces (app/<name>.tsx).
const IN_STORY_ROUTES: ReadonlySet<string> = new Set([
  'reader-composer/[branchId]',
  'world/[branchId]',
  'plot/[branchId]',
  'story-settings/[storyId]',
])

// No story or branch resolved: the story isn't the open one, so nothing on it can be in flight.
function storyBusy(txState: TxState, storyId: string | null, branchId: string | null): boolean {
  return storyId != null && branchId != null && isStoryBusy(txState, storyId, branchId)
}

// A pop lands on the route under this one; with none under it, back leaves the app.
function popLeavesStory(routes: readonly { key: string; name: string }[], routeKey: string) {
  const index = routes.findIndex((route) => route.key === routeKey)
  const below = index > 0 ? routes[index - 1] : undefined
  return below == null || !IN_STORY_ROUTES.has(below.name)
}

/**
 * The story-leave abort-confirm (principles.md → Affordance loci) for one in-story route.
 * While the story is busy (a run on it, a pending turn on `branchId`, or a reversal), a back
 * that lands outside the story waits behind the dialog, and so does a push passed through
 * `guardLeave`. Cancel & leave cancels the story's runs, waits until it is idle, then replays
 * the leave.
 */
export function useStoryLeaveGuard(
  storyId: string | null,
  branchId: string | null,
): {
  /** Runs `proceed` now, or after Cancel & leave while the story is busy. */
  guardLeave: (proceed: () => void) => void
  dialog: JSX.Element | null
} {
  const navigation = useNavigation()
  const isFocused = useIsFocused()
  const { key: routeKey } = useRoute()
  const popLeaves = useNavigationState((state) => popLeavesStory(state.routes, routeKey))
  const inFlight = generationStore.useGeneration((s) => storyBusy(s.txState, storyId, branchId))
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null)
  const [leaving, setLeaving] = useState(false)

  usePreventRemove(isFocused && inFlight && popLeaves, ({ data }) => {
    setPending({ proceed: () => navigation.dispatch(data.action) })
  })

  const guardLeave = useCallback(
    (proceed: () => void) => {
      if (storyBusy(generationStore.getTxState(), storyId, branchId)) setPending({ proceed })
      else proceed()
    },
    [storyId, branchId],
  )

  // Replayed later, a leave held on a screen that lost focus would navigate unasked.
  useEffect(() => {
    if (!isFocused && !leaving) setPending(null)
  }, [isFocused, leaving])

  const stay = useCallback(() => setPending(null), [])
  const confirmLeave = useCallback(() => {
    if (pending == null || storyId == null || branchId == null || leaving) return
    const { proceed } = pending
    setLeaving(true)
    cancelStoryRuns(storyId, branchId).then(
      () => {
        setLeaving(false)
        setPending(null)
        proceed()
      },
      (error: unknown) => {
        setLeaving(false)
        logger.error('app.story_leave_cancel_failed', {
          storyId,
          branchId,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }, [pending, storyId, branchId, leaving])

  // Gated on focus: a Stack keeps pushed-under screens mounted, and their portaled dialog
  // would float over the screen above (lessons-learned/portaled-overlay-outlives-screen-focus.md).
  const dialog = isFocused
    ? createElement(StoryLeaveDialog, {
        open: pending != null,
        leaving,
        onStay: stay,
        onConfirmLeave: confirmLeave,
      })
    : null
  return { guardLeave, dialog }
}
