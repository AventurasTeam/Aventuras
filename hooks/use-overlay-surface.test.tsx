// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chapterOverlaysStore } from '@/lib/stores'

import { useOverlaySurface } from './use-overlay-surface'

type NavigationEvent = 'focus' | 'blur'
type StubNavigation = {
  isFocused: () => boolean
  addListener: (event: NavigationEvent, listener: () => void) => () => void
  emit: (event: NavigationEvent) => void
}
type Guard = (proceed: () => void) => void

// The screen a hook mounts on. Each hook keeps the one set when it mounted, as a screen keeps its
// navigation for its life, so one test can mount two screens.
const mounting = vi.hoisted(() => ({ navigation: null as StubNavigation | null }))

// expo-router's useFocusEffect (build/useFocusEffect.js) over the stub: the real one needs a
// mounted navigator.
vi.mock('expo-router', async () => {
  const { useEffect, useState } = await import('react')
  return {
    useFocusEffect: (effect: () => (() => void) | undefined) => {
      const [navigation] = useState(() => {
        if (mounting.navigation == null) throw new Error('mountOn() a stub navigation first')
        return mounting.navigation
      })
      useEffect(() => {
        let cleanup: (() => void) | undefined
        let focused = false
        const run = () => {
          cleanup?.()
          cleanup = effect()
          focused = true
        }
        if (navigation.isFocused()) run()
        const offFocus = navigation.addListener('focus', () => {
          if (!focused) run()
        })
        const offBlur = navigation.addListener('blur', () => {
          cleanup?.()
          cleanup = undefined
          focused = false
        })
        return () => {
          cleanup?.()
          offFocus()
          offBlur()
        }
      }, [effect, navigation])
    },
  }
})

const navigate = vi.hoisted(() => vi.fn<(path: string) => void>())
vi.mock('./use-surface-navigate', () => ({ useSurfaceNavigate: () => navigate }))

function mountOn(initiallyFocused: boolean): StubNavigation {
  const listeners: Record<NavigationEvent, Set<() => void>> = { focus: new Set(), blur: new Set() }
  let focused = initiallyFocused
  const navigation: StubNavigation = {
    isFocused: () => focused,
    addListener: (event, listener) => {
      listeners[event].add(listener)
      return () => {
        listeners[event].delete(listener)
      }
    },
    emit: (event) => {
      focused = event === 'focus'
      listeners[event].forEach((listener) => listener())
    },
  }
  mounting.navigation = navigation
  return navigation
}

beforeEach(() => {
  chapterOverlaysStore.__reset()
  navigate.mockReset()
  mounting.navigation = null
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useOverlaySurface', () => {
  it('registers on focus, with its guard and the route navigate', () => {
    const navigation = mountOn(false)
    const guard = vi.fn<Guard>()
    renderHook(() => useOverlaySurface(guard))
    expect(chapterOverlaysStore.currentSurface()).toBeNull()

    navigation.emit('focus')
    expect(chapterOverlaysStore.currentSurface()?.guard).toBe(guard)
    expect(chapterOverlaysStore.currentSurface()?.navigate).toBe(navigate)
  })

  it('registers at once on a screen that mounts focused', () => {
    mountOn(true)
    const guard = vi.fn<Guard>()
    renderHook(() => useOverlaySurface(guard))
    expect(chapterOverlaysStore.currentSurface()?.guard).toBe(guard)
  })

  it('drops the registration on blur and takes it back on the next focus', () => {
    const navigation = mountOn(true)
    const guard = vi.fn<Guard>()
    renderHook(() => useOverlaySurface(guard))

    navigation.emit('blur')
    expect(chapterOverlaysStore.currentSurface()).toBeNull()

    navigation.emit('focus')
    expect(chapterOverlaysStore.currentSurface()?.guard).toBe(guard)
  })

  it('drops the registration on unmount', () => {
    mountOn(true)
    const { unmount } = renderHook(() => useOverlaySurface(vi.fn<Guard>()))
    unmount()
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })

  it('re-registers when the guard changes', () => {
    mountOn(true)
    const first = vi.fn<Guard>()
    const second = vi.fn<Guard>()
    const { rerender } = renderHook(({ guard }) => useOverlaySurface(guard), {
      initialProps: { guard: first },
    })
    rerender({ guard: second })
    expect(chapterOverlaysStore.currentSurface()?.guard).toBe(second)
  })

  it('registers nothing when the guard changes on a blurred screen', () => {
    const navigation = mountOn(true)
    const { rerender } = renderHook(({ guard }) => useOverlaySurface(guard), {
      initialProps: { guard: vi.fn<Guard>() },
    })
    navigation.emit('blur')
    rerender({ guard: vi.fn<Guard>() })
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })

  it('keeps the top screen registered when the screen under it blurs last', () => {
    const under = mountOn(true)
    renderHook(() => useOverlaySurface(vi.fn<Guard>()))
    const top = mountOn(false)
    const topGuard = vi.fn<Guard>()
    renderHook(() => useOverlaySurface(topGuard))

    top.emit('focus')
    under.emit('blur')
    expect(chapterOverlaysStore.currentSurface()?.guard).toBe(topGuard)
  })

  it('defaults to a guard that proceeds at once', () => {
    mountOn(true)
    renderHook(() => useOverlaySurface())
    const proceed = vi.fn()
    chapterOverlaysStore.currentSurface()?.guard(proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('keeps one registration across renders with the default guard', () => {
    mountOn(true)
    const register = vi.spyOn(chapterOverlaysStore, 'registerSurface')
    const { rerender } = renderHook(() => useOverlaySurface())
    rerender()
    rerender()
    expect(register).toHaveBeenCalledTimes(1)
  })
})
