import { describe, expect, it } from 'vitest'

import { chaptersStore, type StoreChapter } from './chapters'

function chapterRow(
  id: string,
  sequenceNumber: number,
  title: string,
  branchId = 'br_1',
): StoreChapter {
  return {
    id,
    branchId,
    sequenceNumber,
    title,
    summary: 'S',
    theme: 'T',
    keywords: [],
    startEntryId: 'se_1',
    endEntryId: 'se_2',
    tokenCount: 1000,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: false,
    closeReportActionId: null,
  }
}

describe('chaptersStore', () => {
  it('hydrates and reads by id and by sequence number', () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [chapterRow('chap_1', 1, 'One'), chapterRow('chap_2', 2, 'Two')])
    expect(chaptersStore.getById('chap_1')?.title).toBe('One')
    expect(chaptersStore.getBySequenceNumber('br_1', 2)?.id).toBe('chap_2')
    expect(chaptersStore.getBySequenceNumber('br_1', 9)).toBeUndefined()
    expect(chaptersStore.getChapters().size).toBe(2)
  })

  it('reads the highest-numbered chapter whatever order the rows were stored in', () => {
    chaptersStore.__reset()
    expect(chaptersStore.getLatest('br_1')).toBeUndefined()
    chaptersStore.hydrate('br_1', [
      chapterRow('chap_1', 1, 'One'),
      chapterRow('chap_3', 3, 'Three'),
      chapterRow('chap_0', 0, 'Zero'),
    ])
    expect(chaptersStore.getLatest('br_1')?.id).toBe('chap_3')
    expect(chaptersStore.selectLatest(chaptersStore.getChapters())?.id).toBe('chap_3')
  })

  it('reads no chapter by sequence number or as latest for a branch it does not hold', () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [chapterRow('chap_1', 1, 'One'), chapterRow('chap_2', 2, 'Two')])
    expect(chaptersStore.getBySequenceNumber('br_2', 1)).toBeUndefined()
    expect(chaptersStore.getLatest('br_2')).toBeUndefined()
    expect(chaptersStore.getBySequenceNumber(null, 1)).toBeUndefined()
    expect(chaptersStore.getLatest(null)).toBeUndefined()

    chaptersStore.hydrate('br_2', [chapterRow('chap_1', 1, 'One on two', 'br_2')])
    expect(chaptersStore.getBySequenceNumber('br_1', 1)).toBeUndefined()
    expect(chaptersStore.getLatest('br_1')).toBeUndefined()
    expect(chaptersStore.getBySequenceNumber('br_2', 1)?.title).toBe('One on two')
  })

  it("projects a direct caller's row-shaped create to its report flag, never the report", () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [])
    const {
      hasCloseReport: _flag,
      closeReportActionId: _action,
      ...row
    } = chapterRow('chap_3', 3, 'Three')
    chaptersStore.patch('br_1', {
      op: 'create',
      id: 'chap_3',
      row: { ...row, closeReport: { version: 1, actionId: 'act_1', calls: [], stopped: [] } },
    })
    const stored = chaptersStore.getById('chap_3')
    expect(stored?.hasCloseReport).toBe(true)
    expect(stored?.closeReportActionId).toBe('act_1')
    expect(stored).not.toHaveProperty('closeReport')
  })

  it("keeps a store-shaped create's own report flag and action", () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [])
    chaptersStore.patch('br_1', {
      op: 'create',
      id: 'chap_4',
      row: {
        ...chapterRow('chap_4', 4, 'Four'),
        hasCloseReport: true,
        closeReportActionId: 'act_4',
      },
    })
    expect(chaptersStore.getById('chap_4')?.hasCloseReport).toBe(true)
    expect(chaptersStore.getById('chap_4')?.closeReportActionId).toBe('act_4')
  })

  it('no-ops a patch for a non-held branch', () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [])
    chaptersStore.patch('br_2', {
      op: 'create',
      id: 'chap_9',
      row: chapterRow('chap_9', 9, 'Ghost'),
    })
    expect(chaptersStore.getById('chap_9')).toBeUndefined()
  })
})
