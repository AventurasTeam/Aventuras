// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { chaptersStore, resetAllStores, type StoreChapter } from '@/lib/stores'

import { useCloseResultChapter, useRerunConfirmChapter, type CloseResult } from './chapter-overlays'

function row(branchId: string): StoreChapter {
  return {
    id: 'chap_2',
    branchId,
    sequenceNumber: 2,
    title: 'The Keep Leans Closer',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: 'entry_40',
    endEntryId: 'entry_58',
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: true,
    closeReportActionId: 'act_close_2',
  }
}

function resultOn(branchId: string): CloseResult {
  return {
    branchId,
    openSeq: 1,
    chapterId: 'chap_2',
    actionId: 'act_close_2',
    rerun: false,
    stoppedTasks: 0,
  }
}

beforeEach(() => {
  resetAllStores()
})

afterEach(() => {
  cleanup()
})

// A fork keeps chapter ids, so only the branch read tells the open branch's row from its copy.
describe('the overlay chapter hooks read the branch they are given', () => {
  it("useCloseResultChapter gives back the open branch's row, never a held branch's copy", () => {
    const held = row('br_1')
    chaptersStore.hydrate('br_1', [held])
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) =>
        useCloseResultChapter(resultOn(branchId), { branchId, openSeq: 1 }),
      { initialProps: { branchId: 'br_1' } },
    )
    expect(result.current).toBe(held)

    rerender({ branchId: 'br_2' })
    expect(result.current).toBeNull()

    const copy = row('br_2')
    act(() => chaptersStore.hydrate('br_2', [copy]))
    expect(result.current).toBe(copy)
  })

  it("useRerunConfirmChapter gives back the open branch's row, never a held branch's copy", () => {
    const held = row('br_1')
    chaptersStore.hydrate('br_1', [held])
    const { result, rerender } = renderHook(
      ({ branchId }: { branchId: string }) =>
        useRerunConfirmChapter({ branchId, chapterId: 'chap_2', reopenReview: false }, branchId),
      { initialProps: { branchId: 'br_1' } },
    )
    expect(result.current).toBe(held)

    rerender({ branchId: 'br_2' })
    expect(result.current).toBeNull()

    const copy = row('br_2')
    act(() => chaptersStore.hydrate('br_2', [copy]))
    expect(result.current).toBe(copy)
  })
})
