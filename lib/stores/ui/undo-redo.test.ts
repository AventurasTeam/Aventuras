// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { __redoGroupForTest, type RedoGroup } from '@/lib/actions'

import { undoRedoStore } from './undo-redo'

afterEach(() => {
  cleanup()
  undoRedoStore.__reset()
})

const group = (branchId: string, actionId: string): RedoGroup =>
  __redoGroupForTest(branchId, [], actionId)

describe('undoRedoStore: one stack per branch', () => {
  it("pushes a group onto its own branch's stack", () => {
    const onA = group('A', 'act_a')
    const onB = group('B', 'act_b')
    undoRedoStore.pushRedoGroup(onA)
    undoRedoStore.pushRedoGroup(onB)

    expect(undoRedoStore.peekRedoGroup('A')).toBe(onA)
    expect(undoRedoStore.peekRedoGroup('B')).toBe(onB)
    expect(undoRedoStore.peekRedoGroup('C')).toBeUndefined()
    expect(undoRedoStore.__branches()).toEqual(['A', 'B'])
  })

  it("peeks without removing, and pops A's top, leaving B's", () => {
    const first = group('A', 'act_a1')
    const second = group('A', 'act_a2')
    const onB = group('B', 'act_b')
    undoRedoStore.pushRedoGroup(first)
    undoRedoStore.pushRedoGroup(onB)
    undoRedoStore.pushRedoGroup(second)

    expect(undoRedoStore.peekRedoGroup('A')).toBe(second)
    expect(undoRedoStore.peekRedoGroup('A')).toBe(second)
    expect(undoRedoStore.popRedoGroup('A')).toBe(second)
    expect(undoRedoStore.peekRedoGroup('A')).toBe(first)
    expect(undoRedoStore.peekRedoGroup('B')).toBe(onB)
  })

  it('pops nothing from a branch without a stack, and changes no other', () => {
    const onB = group('B', 'act_b')
    undoRedoStore.pushRedoGroup(onB)

    expect(undoRedoStore.popRedoGroup('A')).toBeUndefined()
    expect(undoRedoStore.__branches()).toEqual(['B'])
    expect(undoRedoStore.peekRedoGroup('B')).toBe(onB)
  })

  it('keeps no entry for a branch whose last group is popped', () => {
    const onA = group('A', 'act_a')
    undoRedoStore.pushRedoGroup(onA)
    undoRedoStore.pushRedoGroup(group('B', 'act_b'))

    expect(undoRedoStore.popRedoGroup('A')).toBe(onA)
    expect(undoRedoStore.__branches()).toEqual(['B'])
    expect(undoRedoStore.hasRedo('A')).toBe(false)
  })

  it.each(['clear', 'drop'] as const)(
    "%s(A) empties A's stack, keeps no entry for it, and leaves B's",
    (member) => {
      const onB = group('B', 'act_b')
      undoRedoStore.pushRedoGroup(group('A', 'act_a1'))
      undoRedoStore.pushRedoGroup(onB)
      undoRedoStore.pushRedoGroup(group('A', 'act_a2'))

      undoRedoStore[member]('A')

      expect(undoRedoStore.peekRedoGroup('A')).toBeUndefined()
      expect(undoRedoStore.__branches()).toEqual(['B'])
      expect(undoRedoStore.peekRedoGroup('B')).toBe(onB)
    },
  )

  it('answers hasRedo per branch', () => {
    undoRedoStore.pushRedoGroup(group('A', 'act_a'))

    expect(undoRedoStore.hasRedo('A')).toBe(true)
    expect(undoRedoStore.hasRedo('B')).toBe(false)
  })

  it('empties every stack on __reset', () => {
    undoRedoStore.pushRedoGroup(group('A', 'act_a'))
    undoRedoStore.pushRedoGroup(group('B', 'act_b'))

    undoRedoStore.__reset()

    expect(undoRedoStore.__branches()).toEqual([])
  })
})

describe('undoRedoStore.useRedoTop', () => {
  it("reads its branch's top through pushes, another branch's writes and a branch change", () => {
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) => undoRedoStore.useRedoTop(branchId),
      { initialProps: { branchId: 'A' } },
    )
    expect(result.current).toBeUndefined()

    const onA = group('A', 'act_a')
    act(() => undoRedoStore.pushRedoGroup(onA))
    expect(result.current).toBe(onA)

    const onB = group('B', 'act_b')
    act(() => undoRedoStore.pushRedoGroup(onB))
    expect(result.current).toBe(onA)

    rerender({ branchId: 'B' })
    expect(result.current).toBe(onB)

    act(() => undoRedoStore.clear('B'))
    expect(result.current).toBeUndefined()

    rerender({ branchId: 'A' })
    expect(result.current).toBe(onA)
  })
})
