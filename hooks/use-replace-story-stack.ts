import {
  CommonActions,
  type NavigationAction,
  type NavigationState,
} from '@react-navigation/native'
import { useNavigationContainerRef } from 'expo-router'
import { useCallback } from 'react'

import { isUnsavedPopArmed } from './leave-guard-chain'

export type StackRoute = { key?: string; name: string; params?: object }

/** Replaces the app Stack in one reset, from anywhere in the container; true when it took. */
export type ReplaceStoryStack = (branchId: string) => boolean

const STORY_LIST = 'index'
const READER = 'reader-composer/[branchId]'

/** `[Story List, Reader(branchId)]`: the List's own route object when present, the reader keyless. */
export function storyStackRoutes(routes: readonly StackRoute[], branchId: string): StackRoute[] {
  const list = routes.find((route) => route.name === STORY_LIST) ?? { name: STORY_LIST }
  return [list, { name: READER, params: { branchId } }]
}

// The app Stack sits under expo-router's `__root` slot, not at the container's root.
function appStackOf(root: NavigationState | undefined): NavigationState | null {
  const state = root?.routes[root.index]?.state
  if (state == null || state.stale !== false) return null
  return state
}

/** The navigation container's calls the reset makes. */
export type StackContainer = {
  isReady: () => boolean
  getRootState: () => NavigationState | undefined
  dispatch: (action: NavigationAction) => void
}

/** One stack reset to `[Story List, Reader(branchId)]` through the container; true when it took. */
export function replaceStoryStack(container: StackContainer, branchId: string): boolean {
  if (!container.isReady()) return false
  const stack = appStackOf(container.getRootState())
  if (stack == null) return false
  // A guard that prevents the reset keeps it to replay once released, after the switch has failed.
  if (stack.routes.some((route) => isUnsavedPopArmed(route.key))) return false
  const replacedTop = stack.routes[stack.index]?.key
  const routes = storyStackRoutes(stack.routes, branchId)
  container.dispatch({
    ...CommonActions.reset({ ...stack, routes, index: routes.length - 1 }),
    target: stack.key,
  })
  // A beforeRemove prevention swallows the whole reset and leaves the stack as it was.
  const after = appStackOf(container.getRootState())
  const top = after?.routes[after.index]
  const params = top?.params as { branchId?: unknown } | undefined
  return top?.name === READER && params?.branchId === branchId && top.key !== replacedTop
}

export function useReplaceStoryStack(): ReplaceStoryStack {
  // router.* queues its dispatch; the container ref resets the app Stack now, from any caller.
  const ref = useNavigationContainerRef()
  return useCallback((branchId: string) => replaceStoryStack(ref, branchId), [ref])
}
