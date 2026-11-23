import { describe, expect, it } from 'vitest'

import type { Happening } from '@/lib/db'

import { happeningsStore } from './happenings'

function row(id: string, title: string): Happening {
  return {
    id,
    branchId: 'br_1',
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

describe('happeningsStore', () => {
  it('hydrates and reads by id', () => {
    happeningsStore.__reset()
    happeningsStore.hydrate('br_1', [row('hap_1', 'Duel'), row('hap_2', 'Coronation')])
    expect(happeningsStore.getById('br_1', 'hap_1')?.title).toBe('Duel')
    expect(happeningsStore.getHappenings().size).toBe(2)
  })

  it('no-ops a patch for a non-held branch', () => {
    happeningsStore.__reset()
    happeningsStore.hydrate('br_1', [])
    happeningsStore.patch('br_2', { op: 'create', id: 'hap_9', row: row('hap_9', 'Ghost') })
    expect(happeningsStore.getById('br_1', 'hap_9')).toBeUndefined()
  })
})
