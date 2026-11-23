import { describe, expect, it } from 'vitest'

import type { Thread } from '@/lib/db'

import { threadsStore } from './threads'

function threadRow(id: string, title: string): Thread {
  return {
    id,
    branchId: 'br_1',
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

describe('threadsStore', () => {
  it('hydrates and reads by id', () => {
    threadsStore.__reset()
    threadsStore.hydrate('br_1', [threadRow('thr_1', 'Quest'), threadRow('thr_2', 'Arc')])
    expect(threadsStore.getById('br_1', 'thr_1')?.title).toBe('Quest')
    expect(threadsStore.getThreads('br_1').size).toBe(2)
  })

  it('no-ops a patch for a non-held branch', () => {
    threadsStore.__reset()
    threadsStore.hydrate('br_1', [])
    threadsStore.patch('br_2', { op: 'create', id: 'thr_9', row: threadRow('thr_9', 'Ghost') })
    expect(threadsStore.getById('br_1', 'thr_9')).toBeUndefined()
  })
})
