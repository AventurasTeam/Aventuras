// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { storyStackRoutes, useReplaceStoryStack, type StackRoute } from './use-replace-story-stack'

type FakeStack = {
  key: string
  index: number
  routeNames: string[]
  routes: StackRoute[]
  type: 'stack'
  stale: false
}

// Stubbed: the real package reaches react-native's Flow source, which the unit bundler can't parse.
vi.mock('@react-navigation/native', () => ({
  CommonActions: {
    reset: (state: object) => ({ type: 'RESET', payload: state }),
  },
}))

const nav = vi.hoisted(() => {
  const state = { ready: true, takes: true, stack: undefined as FakeStack | undefined }
  const dispatch = vi.fn((action: { type: string; payload: FakeStack; target?: string }) => {
    const stack = state.stack
    if (!state.takes || stack == null || action.target !== stack.key) return
    state.stack = {
      ...action.payload,
      routes: action.payload.routes.map((route) =>
        route.key == null ? { ...route, key: `${route.name}-fresh` } : route,
      ),
    }
  })
  const ref = {
    isReady: () => state.ready,
    getRootState: () => ({
      key: 'root-k',
      index: 0,
      routeNames: ['__root'],
      type: 'stack',
      stale: false,
      routes: [{ key: '__root-k', name: '__root', state: state.stack }],
    }),
    dispatch,
  }
  return { state, ref, dispatch }
})

vi.mock('expo-router', () => ({ useNavigationContainerRef: () => nav.ref }))

const ROUTE_NAMES = [
  'index',
  'reader-composer/[branchId]',
  'world/[branchId]',
  'story-settings/[storyId]',
  'chapter-timeline/[branchId]',
]

const list: StackRoute = { key: 'index-k', name: 'index' }
const readerA: StackRoute = {
  key: 'reader-a',
  name: 'reader-composer/[branchId]',
  params: { branchId: 'br_a' },
}
const readerB: StackRoute = {
  key: 'reader-b',
  name: 'reader-composer/[branchId]',
  params: { branchId: 'br_b' },
}
const settings: StackRoute = {
  key: 'settings-k',
  name: 'story-settings/[storyId]',
  params: { storyId: 'story_1' },
}
const worldA: StackRoute = {
  key: 'world-a',
  name: 'world/[branchId]',
  params: { branchId: 'br_a' },
}
const timelineA: StackRoute = {
  key: 'timeline-a',
  name: 'chapter-timeline/[branchId]',
  params: { branchId: 'br_a' },
}
const freshReaderB = { name: 'reader-composer/[branchId]', params: { branchId: 'br_b' } }

const stackOf = (routes: StackRoute[]): FakeStack => ({
  key: 'stack-k',
  index: routes.length - 1,
  routeNames: ROUTE_NAMES,
  routes,
  type: 'stack',
  stale: false,
})

beforeEach(() => {
  nav.state.ready = true
  nav.state.takes = true
  nav.state.stack = undefined
  nav.dispatch.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('storyStackRoutes', () => {
  it('keeps the List itself and adds a keyless Reader(B), from [List, Reader(A)]', () => {
    const next = storyStackRoutes([list, readerA], 'br_b')
    expect(next).toStrictEqual([list, freshReaderB])
    expect(next[0]).toBe(list)
  })

  it('drops Settings, World(A) and Reader(A), from [List, Settings, World(A), Reader(A)]', () => {
    const next = storyStackRoutes([list, settings, worldA, readerA], 'br_b')
    expect(next).toStrictEqual([list, freshReaderB])
    expect(next[0]).toBe(list)
  })

  it('drops Reader(A) and Timeline(A), from [List, Reader(A), Timeline(A)]', () => {
    const next = storyStackRoutes([list, readerA, timelineA], 'br_b')
    expect(next).toStrictEqual([list, freshReaderB])
    expect(next[0]).toBe(list)
  })

  it('starts a keyless List under the reader, from a cold [Reader(A)]', () => {
    expect(storyStackRoutes([readerA], 'br_b')).toStrictEqual([{ name: 'index' }, freshReaderB])
  })
})

describe('useReplaceStoryStack', () => {
  it('replaces the app Stack in one reset targeted at its key, and answers true when it took', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, settings, worldA, readerA])

    expect(result.current('br_b')).toBe(true)

    expect(nav.dispatch).toHaveBeenCalledTimes(1)
    expect(nav.dispatch).toHaveBeenCalledWith({
      type: 'RESET',
      payload: {
        key: 'stack-k',
        index: 1,
        routeNames: ROUTE_NAMES,
        type: 'stack',
        stale: false,
        routes: [list, freshReaderB],
      },
      target: 'stack-k',
    })
    expect(nav.state.stack?.routes).toEqual([
      list,
      { ...freshReaderB, key: 'reader-composer/[branchId]-fresh' },
    ])
  })

  it('answers false when the reset is prevented and the stack stays as it was', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, readerA])
    nav.state.takes = false

    expect(result.current('br_b')).toBe(false)

    expect(nav.dispatch).toHaveBeenCalledTimes(1)
    expect(nav.state.stack?.routes).toEqual([list, readerA])
  })

  it('answers false for a prevented reset even when the top is already a reader on that branch', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, readerB])
    nav.state.takes = false

    expect(result.current('br_b')).toBe(false)
  })

  it('answers false when the stack lands on a reader of another branch', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, readerA])
    nav.dispatch.mockImplementationOnce(() => {
      nav.state.stack = stackOf([
        list,
        { key: 'reader-c', name: 'reader-composer/[branchId]', params: { branchId: 'br_c' } },
      ])
    })

    expect(result.current('br_b')).toBe(false)
  })

  it('answers false when the stack lands on another screen of that branch', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, readerA])
    nav.dispatch.mockImplementationOnce(() => {
      nav.state.stack = stackOf([
        list,
        { key: 'world-b', name: 'world/[branchId]', params: { branchId: 'br_b' } },
      ])
    })

    expect(result.current('br_b')).toBe(false)
  })

  it('answers false and dispatches nothing before the container is ready', () => {
    const { result } = renderHook(() => useReplaceStoryStack())
    nav.state.stack = stackOf([list, readerA])
    nav.state.ready = false

    expect(result.current('br_b')).toBe(false)

    expect(nav.dispatch).not.toHaveBeenCalled()
  })

  it('answers false and dispatches nothing while the app Stack has no state', () => {
    const { result } = renderHook(() => useReplaceStoryStack())

    expect(result.current('br_b')).toBe(false)

    expect(nav.dispatch).not.toHaveBeenCalled()
  })

  it('returns one function across renders, which reads the stack when called', () => {
    const { result, rerender } = renderHook(() => useReplaceStoryStack())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)

    nav.state.stack = stackOf([readerA])

    expect(first('br_b')).toBe(true)
    expect(nav.state.stack?.routes).toEqual([
      { name: 'index', key: 'index-fresh' },
      { ...freshReaderB, key: 'reader-composer/[branchId]-fresh' },
    ])
  })
})
