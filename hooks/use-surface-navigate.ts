import { CommonActions, NavigationContext } from '@react-navigation/native'
import { useRouter, type Href } from 'expo-router'
import { useCallback, useContext } from 'react'

type StackRoute = { key?: string; name: string; params?: object }

const dynamicSegment = (segment: string) => /^\[(.+)\]$/.exec(segment)?.[1]

/** A file-route name + its params, resolved to the pathname this helper matches against. */
export function routePathname(route: StackRoute): string {
  const params = (route.params ?? {}) as Record<string, unknown>
  const segments = route.name.split('/')
  if (segments[segments.length - 1] === 'index') segments.pop()
  if (segments.length === 0) return '/'
  const resolved = segments.map((segment) => {
    const name = dynamicSegment(segment)
    return name == null ? segment : String(params[name])
  })
  return `/${resolved.join('/')}`
}

/**
 * `path`'s query as params for `route`, or null for a path without one. A query key the route
 * holds but the link omits is cleared; the route's path segments and the router's own
 * (`__`-prefixed, nested `params`) keys are left alone.
 */
export function linkParams(route: StackRoute, path: string): Record<string, unknown> | null {
  const query = path.split('?')[1]
  if (!query) return null
  const next: Record<string, unknown> = Object.fromEntries(new URLSearchParams(query))
  const pathKeys = new Set(route.name.split('/').map(dynamicSegment))
  const cleared = Object.keys(route.params ?? {}).filter(
    (key) => !pathKeys.has(key) && !key.startsWith('__') && key !== 'params' && !(key in next),
  )
  return { ...Object.fromEntries(cleared.map((key) => [key, undefined])), ...next }
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
      if (navigation == null || state == null) {
        router.push(path as Href)
        return
      }
      const match = stackIndexOfPath(state.routes, path)
      // A matched screen is reused, and dismiss carries no params: the link's go on first.
      const route = state.routes[match] as StackRoute | undefined
      const params = route == null ? null : linkParams(route, path)
      if (route?.key != null && params != null)
        navigation.dispatch({ ...CommonActions.setParams(params), source: route.key })
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
