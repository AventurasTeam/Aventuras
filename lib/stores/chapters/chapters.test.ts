import { describe, expect, it } from 'vitest'

import type { Chapter } from '@/lib/db'

import { chaptersStore } from './chapters'

function chapterRow(id: string, sequenceNumber: number, title: string): Chapter {
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
