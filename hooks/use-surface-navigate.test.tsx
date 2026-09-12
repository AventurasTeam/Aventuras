// @vitest-environment jsdom
import { NavigationContext } from '@react-navigation/native'
import { renderHook } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { routePathname, stackIndexOfPath, useSurfaceNavigate } from './use-surface-navigate'

// Stubbed: the real package reaches react-native's Flow source, which the unit bundler can't parse.
vi.mock('@react-navigation/native', async () => {
  const { createContext } = await import('react')
  return { NavigationContext: createContext<unknown>(undefined) }
})

const router = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  dismiss: vi.fn<(count?: number) => void>(),
}))
vi.mock('expo-router', () => ({ useRouter: () => router }))

type NavigationValue = ComponentProps<typeof NavigationContext.Provider>['value']

// Only the slice the hook touches; cast at the Provider, which wants a full NavigationProp.
function withNavigation(getState: () => unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NavigationContext.Provider value={{ getState } as unknown as NavigationValue}>
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
