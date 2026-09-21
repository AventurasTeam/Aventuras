import { describe, expect, it } from 'vitest'

import type { Thread } from '@/lib/db'

import { groupThreadsByTier, queryThreads } from './thread-list'

function thread(
  id: string,
  status: Thread['status'],
  title: string,
  extra: Partial<Thread> = {},
): Thread {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: null,
    icon: null,
    status,
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const ROWS = [
  thread('t_fail', 'failed', 'Escape the keep'),
  thread('t_res', 'resolved', 'Earn trust'),
  thread('t_act_b', 'active', 'Bargain', { description: 'Vorne answers to someone.' }),
  thread('t_pend', 'pending', 'Expose the broker', { category: 'goal' }),
  thread('t_act_a', 'active', 'Amulet'),
]

describe('queryThreads', () => {
  it('sorts by status tier then title on the All view', () => {
    expect(queryThreads(ROWS, { search: '', filter: 'all' }).map((r) => r.id)).toEqual([
      't_act_a',
      't_act_b',
      't_pend',
      't_res',
      't_fail',
    ])
  })

  it('flattens to one tier under a chip', () => {
    expect(queryThreads(ROWS, { search: '', filter: 'active' }).map((r) => r.id)).toEqual([
      't_act_a',
      't_act_b',
    ])
  })

  it('searches title, description and category', () => {
    expect(queryThreads(ROWS, { search: 'vorne', filter: 'all' }).map((r) => r.id)).toEqual([
      't_act_b',
    ])
    expect(queryThreads(ROWS, { search: 'goal', filter: 'all' }).map((r) => r.id)).toEqual([
      't_pend',
    ])
  })
})

describe('groupThreadsByTier', () => {
  it('orders Active, Pending, Resolved, Failed and omits empty tiers', () => {
    const grouped = groupThreadsByTier(queryThreads(ROWS, { search: '', filter: 'all' }))
    expect(grouped.pinned).toBeNull()
    expect(grouped.groups.map((g) => g.key)).toEqual(['active', 'pending', 'resolved', 'failed'])
    expect(groupThreadsByTier([ROWS[0]]).groups.map((g) => g.key)).toEqual(['failed'])
  })
})
