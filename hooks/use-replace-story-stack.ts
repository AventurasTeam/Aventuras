import { CommonActions, type NavigationState } from '@react-navigation/native'
import { useNavigationContainerRef } from 'expo-router'
import { useCallback } from 'react'

export type StackRoute = { key?: string; name: string; params?: object }

/** Replaces the app Stack in one reset; true when it took. Callable from a screen or the root host. */
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

export function useReplaceStoryStack(): ReplaceStoryStack {
  // Not router.* (it dispatches in an effect after a commit) nor NavigationContext (the root
  // host's is __root's): the container ref reaches the app Stack in one dispatch from anywhere.
  const ref = useNavigationContainerRef()
  return useCallback(
    (branchId: string) => {
      if (!ref.isReady()) return false
      const stack = appStackOf(ref.getRootState())
      if (stack == null) return false
      const replacedTop = stack.routes[stack.index]?.key
      const routes = storyStackRoutes(stack.routes, branchId)
      ref.dispatch({
        ...CommonActions.reset({ ...stack, routes, index: routes.length - 1 }),
        target: stack.key,
      })
      // A beforeRemove prevention swallows the whole reset and leaves the stack as it was.
      const after = appStackOf(ref.getRootState())
      const top = after?.routes[after.index]
      const params = top?.params as { branchId?: unknown } | undefined
      return top?.name === READER && params?.branchId === branchId && top.key !== replacedTop
    },
    [ref],
  )
}
