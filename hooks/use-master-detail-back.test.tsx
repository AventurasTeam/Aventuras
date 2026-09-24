// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { blockingOverlaysStore, useRegisteredOverlay } from '@/lib/stores'

import { useMasterDetailBack } from './use-master-detail-back'

const back = vi.hoisted(() => ({ handlers: [] as (() => boolean)[] }))

vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Platform: {
    OS: 'android',
    select: (spec: Record<string, unknown>) => spec.android ?? spec.native ?? spec.default,
  },
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      back.handlers.push(handler)
      return { remove: () => back.handlers.splice(back.handlers.indexOf(handler), 1) }
    },
  },
}))

vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }
})

// BackHandler runs the latest registration first and stops at the first `true`.
function pressBack(): boolean {
  return [...back.handlers].reverse().some((handler) => handler())
}

beforeEach(() => {
  back.handlers.length = 0
  blockingOverlaysStore.__reset()
})

afterEach(() => blockingOverlaysStore.__reset())

describe('useMasterDetailBack', () => {
  it('collapses and consumes back while it can collapse', () => {
    const onCollapse = vi.fn()
    renderHook(() => useMasterDetailBack(true, onCollapse))
    expect(pressBack()).toBe(true)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('falls through to the route pop when it cannot collapse', () => {
    const onCollapse = vi.fn()
    renderHook(() => useMasterDetailBack(false, onCollapse))
    expect(pressBack()).toBe(false)
    expect(onCollapse).not.toHaveBeenCalled()
  })

  it('yields to a blocking overlay that registered its own handler first', () => {
    const closeOverlay = vi.fn(() => true)
    back.handlers.push(closeOverlay)
    renderHook(() => useRegisteredOverlay(true))
    const onCollapse = vi.fn()
    renderHook(() => useMasterDetailBack(true, onCollapse))

    expect(pressBack()).toBe(true)
    expect(closeOverlay).toHaveBeenCalledTimes(1)
    expect(onCollapse).not.toHaveBeenCalled()
  })
})
