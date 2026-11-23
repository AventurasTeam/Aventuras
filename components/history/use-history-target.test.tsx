// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Happening, Thread } from '@/lib/db'
import type { HistoryTable } from '@/lib/history'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
import { entitiesStore, happeningsStore, loreStore, threadsStore } from '@/lib/stores'

import { historyTargetName, useHistoryTarget, type HistoryTarget } from './use-history-target'

const A = 'br_a'
const B = 'br_b'
// One id on both branches, as a fork's copy keeps it.
const X = 'row_x'

function thread(branchId: string, title: string): Thread {
  return {
    id: X,
    branchId,
    title,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function happening(branchId: string, title: string): Happening {
  return {
    id: X,
    branchId,
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

/** Hydrates the table's store for `branchId` with one row under X, named `label`, and returns it. */
type TableCase = { table: HistoryTable; seed: (branchId: string, label: string) => HistoryTarget }

const TABLES: readonly TableCase[] = [
  {
    table: 'entities',
    seed: (branchId, label) => {
      const row = makeEntity({ id: X, kind: 'character', name: label, branchId })
      entitiesStore.hydrate(branchId, [row])
      return row
    },
  },
  {
    table: 'lore',
    seed: (branchId, label) => {
      const row = makeLore({ id: X, title: label, branchId })
      loreStore.hydrate(branchId, [row])
      return row
    },
  },
  {
    table: 'threads',
    seed: (branchId, label) => {
      const row = thread(branchId, label)
      threadsStore.hydrate(branchId, [row])
      return row
    },
  },
  {
    table: 'happenings',
    seed: (branchId, label) => {
      const row = happening(branchId, label)
      happeningsStore.hydrate(branchId, [row])
      return row
    },
  },
]

function resetStores(): void {
  entitiesStore.__reset()
  loreStore.__reset()
  threadsStore.__reset()
  happeningsStore.__reset()
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
  resetStores()
})

describe.each(TABLES)('useHistoryTarget on a $table tab', ({ table, seed }) => {
  it("reads nothing while the store holds another branch's row under the id", () => {
    seed(B, 'On B')
    const { result } = renderHook(() => useHistoryTarget(A, table, X))
    expect(result.current).toBeUndefined()
  })

  it("reads the tab branch's row once its branch is loaded, and nothing after another branch's hydrate", () => {
    seed(B, 'On B')
    const { result } = renderHook(() => useHistoryTarget(A, table, X))

    let onA: HistoryTarget | undefined
    act(() => {
      onA = seed(A, 'On A')
    })
    expect(historyTargetName(result.current)).toBe('On A')
    expect(result.current).toBe(onA)

    act(() => {
      seed(B, 'On B again')
    })
    expect(result.current).toBeUndefined()
  })
})

describe('useHistoryTarget', () => {
  it("reads only the tab's table: an entity under the id is no lore target", () => {
    entitiesStore.hydrate(A, [makeEntity({ id: X, kind: 'character', name: 'Kael', branchId: A })])
    const { result } = renderHook(() => useHistoryTarget(A, 'lore', X))
    expect(result.current).toBeUndefined()
  })
})
