import { NavigationContext } from '@react-navigation/native'
import { useRouter, type Href } from 'expo-router'
import { useCallback, useContext } from 'react'

type StackRoute = { name: string; params?: object }

/** A file-route name + its params, resolved to the pathname this helper matches against. */
export function routePathname(route: StackRoute): string {
  const params = (route.params ?? {}) as Record<string, unknown>
  const segments = route.name.split('/')
  if (segments[segments.length - 1] === 'index') segments.pop()
  if (segments.length === 0) return '/'
  const resolved = segments.map((segment) => {
    const match = /^\[(.+)\]$/.exec(segment)
    return match == null ? segment : String(params[match[1]])
  })
  return `/${resolved.join('/')}`
}

/** The last stack index whose route resolves to `path` (query stripped), or -1. */
export function stackIndexOfPath(routes: readonly StackRoute[], path: string): number {
  const [target] = path.split('?')
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    if (routePathname(routes[i]) === target) return i
  }
  return -1
}

/**
 * Matches against the leaf routes of the stack containing the screen (the root Stack for
 * in-story surfaces); pushes when no navigator is found.
 */
export function useSurfaceNavigate(): (path: string) => void {
  // useContext, not useNavigation: the latter throws outside a navigator (e.g. Storybook).
  const navigation = useContext(NavigationContext)
  const router = useRouter()
  return useCallback(
    (path: string) => {
      const state = navigation?.getState()
      if (state == null) {
        router.push(path as Href)
        return
      }
      const match = stackIndexOfPath(state.routes, path)
      if (match === state.index) return
      // dismissTo replaces the top screen; pop to an exact match instead, so Return lands right.
      if (match !== -1 && match < state.index) {
        router.dismiss(state.index - match)
        return
      }
      router.push(path as Href)
    },
    [navigation, router],
  )
}
