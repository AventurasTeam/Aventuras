// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'
import { entriesStore, resetAllStores } from '@/lib/stores'

import { useBranchTailId } from './use-branch-tail-id'

function entry(id: string, position: number, branchId = 'br_1'): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind: 'user_action',
    content: '',
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

afterEach(() => {
  cleanup()
  resetAllStores()
})

describe('useBranchTailId', () => {
  it("names the branch's highest-position entry, whatever the store's order", () => {
    entriesStore.hydrate('br_1', [entry('e3', 3), entry('e9', 9), entry('e1', 1)])
    const { result } = renderHook(() => useBranchTailId('br_1'))
    expect(result.current).toBe('e9')
  })

  it('names none while another branch is loaded, and follows its own branch when it loads', () => {
    entriesStore.hydrate('br_2', [entry('f9', 9, 'br_2')])
    const { result } = renderHook(() => useBranchTailId('br_1'))
    expect(result.current).toBeNull()

    act(() => entriesStore.hydrate('br_1', [entry('e2', 2)]))
    expect(result.current).toBe('e2')

    act(() => entriesStore.hydrate('br_2', [entry('f9', 9, 'br_2')]))
    expect(result.current).toBeNull()
  })

  it('names none for no branch', () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    const { result } = renderHook(() => useBranchTailId(null))
    expect(result.current).toBeNull()
  })
})
