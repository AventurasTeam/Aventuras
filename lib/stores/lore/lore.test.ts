import { describe, expect, it } from 'vitest'

import type { Lore } from '@/lib/db'

import { loreStore } from './lore'

function loreRow(id: string, title: string): Lore {
  return {
    id,
    branchId: 'br_1',
    title,
    body: null,
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('loreStore', () => {
  it('hydrates and reads by id', () => {
    loreStore.__reset()
    loreStore.hydrate('br_1', [loreRow('lore_1', 'Magic'), loreRow('lore_2', 'Religion')])
    expect(loreStore.getById('br_1', 'lore_1')?.title).toBe('Magic')
    expect(loreStore.getLore('br_1').size).toBe(2)
  })

  it('no-ops a patch for a non-held branch', () => {
    loreStore.__reset()
    loreStore.hydrate('br_1', [])
    loreStore.patch('br_2', { op: 'create', id: 'lore_9', row: loreRow('lore_9', 'Ghost') })
    expect(loreStore.getById('br_1', 'lore_9')).toBeUndefined()
  })
})
