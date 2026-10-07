// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readerRailStore } from './reader-rail'

describe('readerRailStore.useCategory', () => {
  beforeEach(() => {
    readerRailStore.__reset()
  })
  afterEach(() => {
    cleanup()
  })

  it('follows the category and ignores filter and search edits', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return readerRailStore.useCategory()
    })
    expect(result.current).toBe('character')
    const before = renders

    act(() => readerRailStore.setView({ category: 'character', filter: 'staged', search: 'Mira' }))
    expect(renders).toBe(before)

    act(() => readerRailStore.setCategory('happening'))
    expect(result.current).toBe('happening')
    expect(renders).toBeGreaterThan(before)
  })
})

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
        return readerRailStore.useCollapsed(stored)
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
})
