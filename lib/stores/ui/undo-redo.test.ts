import { afterEach, describe, expect, it } from 'vitest'

import type { RedoSnapshot } from '@/lib/actions'

import { undoRedoStore } from './undo-redo'

afterEach(() => {
  undoRedoStore.clear()
})

function group(branchId: string): RedoSnapshot[] {
  return [{ delta: { branchId } as RedoSnapshot['delta'], rowBeforeUndo: null }]
}

describe('undoRedoStore.peekRedoGroup', () => {
  it('returns undefined on an empty stack without mutating it', () => {
    expect(undoRedoStore.peekRedoGroup()).toBeUndefined()
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('reads the top group without removing it', () => {
    const top = group('b1')
    undoRedoStore.pushRedoGroup(top)

    expect(undoRedoStore.peekRedoGroup()).toBe(top)
    // A second peek still sees the same top — peek never pops.
    expect(undoRedoStore.peekRedoGroup()).toBe(top)
    expect(undoRedoStore.hasRedo()).toBe(true)
  })

  it('peeks the most-recent group; pop then reveals the prior one', () => {
    const first = group('b1')
    const second = group('b2')
    undoRedoStore.pushRedoGroup(first)
    undoRedoStore.pushRedoGroup(second)

    expect(undoRedoStore.peekRedoGroup()).toBe(second)
    expect(undoRedoStore.popRedoGroup()).toBe(second)
    expect(undoRedoStore.peekRedoGroup()).toBe(first)
  })
})
