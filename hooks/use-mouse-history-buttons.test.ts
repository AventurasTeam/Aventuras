// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRegisteredOverlay } from '@/lib/stores'

import { isMouseBackInert, useInertMouseBack } from './use-inert-mouse-back'
import { useMouseHistoryButtons } from './use-mouse-history-buttons'

const platform = vi.hoisted(() => ({ os: 'web' }))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<{ Platform: object }>()
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platform.os
      },
    },
  }
})

const router = vi.hoisted(() => ({ back: vi.fn(), canGoBack: vi.fn(() => true) }))
vi.mock('expo-router', () => ({ useRouter: () => router }))

// Electron goes back or forward in history on these buttons' mouseup unless it's cancelled.
function mouseUp(button: number): boolean {
  const event = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  platform.os = 'web'
  router.back.mockClear()
  router.canGoBack.mockReturnValue(true)
})

afterEach(cleanup)

describe('useMouseHistoryButtons', () => {
  it('cancels Back and takes the app’s own back instead', () => {
    renderHook(() => useMouseHistoryButtons())
    expect(mouseUp(3)).toBe(true)
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('cancels Forward and goes nowhere', () => {
    renderHook(() => useMouseHistoryButtons())
    expect(mouseUp(4)).toBe(true)
    expect(router.back).not.toHaveBeenCalled()
  })

  it.each([0, 1, 2])('leaves button %s alone', (button) => {
    renderHook(() => useMouseHistoryButtons())
    expect(mouseUp(button)).toBe(false)
  })

  it('goes back nowhere while an overlay is up, and again once it closes', () => {
    renderHook(() => useMouseHistoryButtons())
    const overlay = renderHook(({ open }) => useRegisteredOverlay(open), {
      initialProps: { open: true },
    })
    expect(mouseUp(3)).toBe(true)
    expect(router.back).not.toHaveBeenCalled()
    overlay.rerender({ open: false })
    mouseUp(3)
    expect(router.back).toHaveBeenCalledTimes(1)
  })

  it('goes back nowhere at the root', () => {
    router.canGoBack.mockReturnValue(false)
    renderHook(() => useMouseHistoryButtons())
    expect(mouseUp(3)).toBe(true)
    expect(router.back).not.toHaveBeenCalled()
  })

  it('cancels nothing off web', () => {
    platform.os = 'android'
    renderHook(() => useMouseHistoryButtons())
    expect(mouseUp(3)).toBe(false)
    expect(router.back).not.toHaveBeenCalled()
  })
})

describe('useInertMouseBack', () => {
  it('holds Back inert only while active, and the buttons go nowhere meanwhile', () => {
    renderHook(() => useMouseHistoryButtons())
    const hook = renderHook(({ on }: { on: boolean }) => useInertMouseBack(on), {
      initialProps: { on: false },
    })
    expect(isMouseBackInert()).toBe(false)
    hook.rerender({ on: true })
    expect(isMouseBackInert()).toBe(true)
    expect(mouseUp(3)).toBe(true)
    expect(router.back).not.toHaveBeenCalled()
    hook.rerender({ on: false })
    expect(isMouseBackInert()).toBe(false)
  })

  it('stays inert while a second surface holds it after the first lets go', () => {
    const first = renderHook(({ on }: { on: boolean }) => useInertMouseBack(on), {
      initialProps: { on: true },
    })
    const second = renderHook(() => useInertMouseBack(true))
    act(() => first.rerender({ on: false }))
    expect(isMouseBackInert()).toBe(true)
    second.unmount()
    expect(isMouseBackInert()).toBe(false)
  })
})
