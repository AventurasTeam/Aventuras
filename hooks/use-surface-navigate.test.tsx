// @vitest-environment jsdom
import { NavigationContext } from '@react-navigation/native'
import { renderHook } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { routePathname, stackIndexOfPath, useSurfaceNavigate } from './use-surface-navigate'

// Stubbed: the real package reaches react-native's Flow source, which the unit bundler can't parse.
vi.mock('@react-navigation/native', async () => {
  const { createContext } = await import('react')
  return {
    NavigationContext: createContext<unknown>(undefined),
    CommonActions: {
      setParams: (params: object) => ({ type: 'SET_PARAMS', payload: { params } }),
    },
  }
})

const router = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  dismiss: vi.fn<(count?: number) => void>(),
}))
vi.mock('expo-router', () => ({ useRouter: () => router }))

type NavigationValue = ComponentProps<typeof NavigationContext.Provider>['value']

// Only the slice the hook touches; cast at the Provider, which wants a full NavigationProp.
function withNavigation(getState: () => unknown, dispatch: (action: unknown) => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationContext.Provider value={{ getState, dispatch } as unknown as NavigationValue}>
        {children}
      </NavigationContext.Provider>
    )
  }
}

beforeEach(() => {
  router.push.mockReset()
  router.dismiss.mockReset()
})

describe('routePathname', () => {
  it('resolves a dynamic segment from params', () => {
    expect(
      routePathname({ name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } }),
    ).toBe('/reader-composer/br_1')
  })

  it('maps the root index route to /', () => {
    expect(routePathname({ name: 'index' })).toBe('/')
  })

  it('drops a trailing /index segment', () => {
    expect(routePathname({ name: 'diagnostics/index' })).toBe('/diagnostics')
  })
})

describe('stackIndexOfPath', () => {
  const routes = [
    { name: 'index' },
    { name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } },
    { name: 'world/[branchId]', params: { branchId: 'br_1' } },
  ]

  it('finds the matching route by resolved path', () => {
    expect(stackIndexOfPath(routes, '/world/br_1')).toBe(2)
  })

  it('strips a query string before matching', () => {
    expect(stackIndexOfPath(routes, '/reader-composer/br_1?tab=memory')).toBe(1)
  })

  it('treats a different branch id as a non-match (exact on params)', () => {
    expect(stackIndexOfPath(routes, '/reader-composer/br_2')).toBe(-1)
  })

  it('returns the last index when the same route appears twice', () => {
    const withDuplicate = [
      ...routes,
      { name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } },
    ]
    expect(stackIndexOfPath(withDuplicate, '/reader-composer/br_1')).toBe(3)
  })
})

describe('useSurfaceNavigate', () => {
  it('pops by the exact count when the target is one below', () => {
    const getState = vi.fn().mockReturnValue({
      index: 2,
      routes: [
        { name: 'index' },
        { name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } },
        { name: 'world/[branchId]', params: { branchId: 'br_1' } },
      ],
    })
    const { result } = renderHook(() => useSurfaceNavigate(), { wrapper: withNavigation(getState) })
    result.current('/reader-composer/br_1')
    expect(router.dismiss).toHaveBeenCalledWith(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('pops by the exact count when the target is several below', () => {
    const getState = vi.fn().mockReturnValue({
      index: 3,
      routes: [
        { name: 'index' },
        { name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } },
        { name: 'story-settings/[storyId]', params: { storyId: 'story_1' } },
        { name: 'world/[branchId]', params: { branchId: 'br_1' } },
      ],
    })
    const { result } = renderHook(() => useSurfaceNavigate(), { wrapper: withNavigation(getState) })
    result.current('/reader-composer/br_1')
    expect(router.dismiss).toHaveBeenCalledWith(2)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('pushes a new instance when the target is not in the stack', () => {
    const getState = vi.fn().mockReturnValue({
      index: 0,
      routes: [{ name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } }],
    })
    const { result } = renderHook(() => useSurfaceNavigate(), { wrapper: withNavigation(getState) })
    result.current('/world/br_1')
    expect(router.push).toHaveBeenCalledWith('/world/br_1')
    expect(router.dismiss).not.toHaveBeenCalled()
  })

  it('no-ops when the target is already the current top', () => {
    const getState = vi.fn().mockReturnValue({
      index: 0,
      routes: [{ name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } }],
    })
    const { result } = renderHook(() => useSurfaceNavigate(), { wrapper: withNavigation(getState) })
    result.current('/reader-composer/br_1')
    expect(router.push).not.toHaveBeenCalled()
    expect(router.dismiss).not.toHaveBeenCalled()
  })

  it('reads navigation state at call time, not at render time', () => {
    const getState = vi.fn().mockReturnValue({
      index: 0,
      routes: [{ name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } }],
    })
    const { result } = renderHook(() => useSurfaceNavigate(), { wrapper: withNavigation(getState) })
    // Stack grows after render, before the jump fires; a render-time snapshot would wrongly no-op.
    getState.mockReturnValue({
      index: 1,
      routes: [
        { name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } },
        { name: 'world/[branchId]', params: { branchId: 'br_1' } },
      ],
    })
    result.current('/reader-composer/br_1')
    expect(router.dismiss).toHaveBeenCalledWith(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('pushes when no navigator is found, instead of throwing', () => {
    const { result } = renderHook(() => useSurfaceNavigate())
    result.current('/world/br_1')
    expect(router.push).toHaveBeenCalledWith('/world/br_1')
    expect(router.dismiss).not.toHaveBeenCalled()
  })
})

describe('useSurfaceNavigate — a link to a screen already on the stack', () => {
  const reader = { key: 'r0', name: 'reader-composer/[branchId]', params: { branchId: 'br_1' } }
  const plot = (params: object) => ({
    key: 'p1',
    name: 'plot/[branchId]',
    params: { branchId: 'br_1', ...params },
  })
  const world = { key: 'w2', name: 'world/[branchId]', params: { branchId: 'br_1' } }

  function navigate(state: unknown, path: string) {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useSurfaceNavigate(), {
      wrapper: withNavigation(() => state, dispatch),
    })
    result.current(path)
    return dispatch
  }

  it("sets the link's params on that screen, then pops to it", () => {
    const state = { index: 2, routes: [reader, plot({ kind: 'happening', id: 'hap_1' }), world] }
    const dispatch = navigate(state, '/plot/br_1?kind=happening&id=hap_2&tab=involvements')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PARAMS',
      payload: { params: { kind: 'happening', id: 'hap_2', tab: 'involvements' } },
      source: 'p1',
    })
    expect(router.dismiss).toHaveBeenCalledWith(1)
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      router.dismiss.mock.invocationCallOrder[0],
    )
  })

  it('clears a link param the new link omits, and leaves path and router params alone', () => {
    const stale = plot({
      kind: 'happening',
      id: 'hap_1',
      tab: 'awareness',
      __internal_expo_router_no_animation: true,
    })
    const dispatch = navigate(
      { index: 2, routes: [reader, stale, world] },
      '/plot/br_1?kind=thread&id=thr_1',
    )
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { params: { tab: undefined, kind: 'thread', id: 'thr_1' } },
      }),
    )
  })

  it('sets the link on the current top without popping', () => {
    const dispatch = navigate(
      { index: 1, routes: [reader, plot({ kind: 'thread', id: 'thr_1' })] },
      '/plot/br_1?kind=happening&id=hap_2',
    )
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ source: 'p1' }))
    expect(router.dismiss).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('leaves the params alone for a path with no query', () => {
    const dispatch = navigate(
      { index: 2, routes: [reader, plot({ kind: 'thread', id: 'thr_1' }), world] },
      '/plot/br_1',
    )
    expect(dispatch).not.toHaveBeenCalled()
    expect(router.dismiss).toHaveBeenCalledWith(1)
  })
})
