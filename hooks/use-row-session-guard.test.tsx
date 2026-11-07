// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RowSessionHandle } from './use-row-save-session'
import { useRowSessionGuard } from './use-row-session-guard'

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<(path: string) => void>(),
  armedWith: [] as boolean[],
}))

// Navigation and the window-close bridge have their own tests; this file pins what the guard
// derives from the handle it holds.
vi.mock('./use-surface-navigate', () => ({ useSurfaceNavigate: () => stubs.navigate }))
vi.mock('./use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: (dirty: boolean) => {
    stubs.armedWith.push(dirty)
  },
}))

function handle(dirty: boolean) {
  return { dirty, requestLeave: vi.fn<(proceed: () => void) => void>() } satisfies RowSessionHandle
}

describe('useRowSessionGuard', () => {
  beforeEach(() => {
    stubs.navigate.mockReset()
    stubs.armedWith = []
  })
  afterEach(() => {
    cleanup()
  })

  it('reads clean and lets a leave through with no session registered', () => {
    const { result } = renderHook(() => useRowSessionGuard())
    expect(result.current.dirty).toBe(false)
    const proceed = vi.fn()
    result.current.guard(proceed)
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('reads a dirty handle dirty, and arms the window guard with it', () => {
    const { result } = renderHook(() => useRowSessionGuard())
    const dirtyHandle = handle(true)
    act(() => result.current.onSession(dirtyHandle))
    expect(result.current.dirty).toBe(true)
    expect(stubs.armedWith.at(-1)).toBe(true)

    const proceed = vi.fn()
    result.current.guard(proceed)
    expect(proceed).not.toHaveBeenCalled()
    expect(dirtyHandle.requestLeave).toHaveBeenCalledWith(proceed)
  })

  it('follows a handle that turns clean', () => {
    const { result } = renderHook(() => useRowSessionGuard())
    act(() => result.current.onSession(handle(true)))
    act(() => result.current.onSession(handle(false)))
    expect(result.current.dirty).toBe(false)
    expect(stubs.armedWith.at(-1)).toBe(false)
  })

  it('reads clean again once the session unregisters', () => {
    const { result } = renderHook(() => useRowSessionGuard())
    act(() => result.current.onSession(handle(true)))
    act(() => result.current.onSession(null))
    expect(result.current.dirty).toBe(false)
  })
})
