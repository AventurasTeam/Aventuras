// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInertMouseBack } from './use-inert-mouse-back'

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

// Electron goes back or forward in history on these buttons' mouseup unless it's cancelled.
function mouseUp(button: number): boolean {
  const event = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event.defaultPrevented
}

function renderInert(active: boolean) {
  return renderHook(({ on }: { on: boolean }) => useInertMouseBack(on), {
    initialProps: { on: active },
  })
}

beforeEach(() => {
  platform.os = 'web'
})

afterEach(cleanup)

describe('useInertMouseBack', () => {
  it.each([3, 4])('cancels button %s only while active', (button) => {
    const hook = renderInert(false)
    expect(mouseUp(button)).toBe(false)
    hook.rerender({ on: true })
    expect(mouseUp(button)).toBe(true)
    hook.rerender({ on: false })
    expect(mouseUp(button)).toBe(false)
  })

  it.each([0, 1, 2])('leaves button %s alone while active', (button) => {
    renderInert(true)
    expect(mouseUp(button)).toBe(false)
  })

  it('stops cancelling once unmounted while active', () => {
    const hook = renderInert(true)
    expect(mouseUp(3)).toBe(true)
    hook.unmount()
    expect(mouseUp(3)).toBe(false)
  })

  it('cancels nothing off web', () => {
    platform.os = 'android'
    renderInert(true)
    expect(mouseUp(3)).toBe(false)
  })
})
