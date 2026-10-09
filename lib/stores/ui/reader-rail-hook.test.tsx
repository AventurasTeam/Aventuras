// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readerRailStore } from './reader-rail'

describe('readerRailStore.useCollapsed', () => {
  beforeEach(() => {
    readerRailStore.__reset()
  })
  afterEach(() => {
    cleanup()
  })

  it('follows the stored preference, a pending toggle and a forced collapse', () => {
    let renders = 0
    const { result, rerender } = renderHook(
      ({ stored }: { stored: boolean }) => {
        renders += 1
        return readerRailStore.useCollapsed(stored, 1200)
      },
      { initialProps: { stored: false } },
    )
    expect(result.current).toBe(false)
    rerender({ stored: true })
    expect(result.current).toBe(true)
    rerender({ stored: false })

    const before = renders
    act(() => readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 }))
    expect(renders).toBe(before)

    act(() => readerRailStore.dispatchDisplay({ type: 'resize', width: 850 }))
    expect(result.current).toBe(true)
    act(() => readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false }))
    expect(result.current).toBe(false)
    act(() => readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true }))
    expect(result.current).toBe(true)
  })

  it('reads the window width until the watcher reports one', () => {
    const { result, rerender } = renderHook(
      ({ windowWidth }: { windowWidth: number }) =>
        readerRailStore.useCollapsed(false, windowWidth),
      { initialProps: { windowWidth: 850 } },
    )
    expect(result.current).toBe(true)
    rerender({ windowWidth: 1200 })
    expect(result.current).toBe(false)

    // Once a width is known it decides, whatever the caller passes.
    act(() => readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 }))
    rerender({ windowWidth: 850 })
    expect(result.current).toBe(false)
  })
})
