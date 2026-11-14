import { describe, expect, it } from 'vitest'

import { chaptersStore, type StoreChapter } from './chapters'

function chapterRow(id: string, sequenceNumber: number, title: string): StoreChapter {
  return {
    id,
    branchId: 'br_1',
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
  }
}

describe('chaptersStore', () => {
  it('hydrates and reads by id and by sequence number', () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [chapterRow('chap_1', 1, 'One'), chapterRow('chap_2', 2, 'Two')])
    expect(chaptersStore.getById('chap_1')?.title).toBe('One')
    expect(chaptersStore.getBySequenceNumber(2)?.id).toBe('chap_2')
    expect(chaptersStore.getBySequenceNumber(9)).toBeUndefined()
    expect(chaptersStore.getChapters().size).toBe(2)
  })

  it('reads the highest-numbered chapter whatever order the rows were stored in', () => {
    chaptersStore.__reset()
    expect(chaptersStore.getLatest()).toBeUndefined()
    chaptersStore.hydrate('br_1', [
      chapterRow('chap_1', 1, 'One'),
      chapterRow('chap_3', 3, 'Three'),
      chapterRow('chap_0', 0, 'Zero'),
    ])
    expect(chaptersStore.getLatest()?.id).toBe('chap_3')
    expect(chaptersStore.selectLatest(chaptersStore.getChapters())?.id).toBe('chap_3')
  })

  it("projects a direct caller's row-shaped create to its report flag, never the report", () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [])
    const { hasCloseReport: _flag, ...row } = chapterRow('chap_3', 3, 'Three')
    chaptersStore.patch('br_1', {
      op: 'create',
      id: 'chap_3',
      row: { ...row, closeReport: { version: 1, actionId: 'act_1', calls: [], stopped: [] } },
    })
    const stored = chaptersStore.getById('chap_3')
    expect(stored?.hasCloseReport).toBe(true)
    expect(stored).not.toHaveProperty('closeReport')
  })

  it("keeps a store-shaped create's own report flag", () => {
    chaptersStore.__reset()
    chaptersStore.hydrate('br_1', [])
    chaptersStore.patch('br_1', {
      op: 'create',
      id: 'chap_4',
      row: { ...chapterRow('chap_4', 4, 'Four'), hasCloseReport: true },
    })
    expect(chaptersStore.getById('chap_4')?.hasCloseReport).toBe(true)
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
