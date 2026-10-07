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
