import { describe, expect, it } from 'vitest'

import type { BranchEraFlip } from '@/lib/db'

import { eraFlipsStore } from './era-flips'

function flipRow(id: string, atWorldtime: number, eraName: string): BranchEraFlip {
  return { id, branchId: 'br_1', atWorldtime, eraName, createdAt: 1 }
}

describe('eraFlipsStore', () => {
  it('hydrates and reads by id', () => {
    eraFlipsStore.__reset()
    eraFlipsStore.hydrate('br_1', [
      flipRow('ef_1', 1000, 'Age of Ash'),
      flipRow('ef_2', 2000, 'Age of Storms'),
    ])
    expect(eraFlipsStore.getById('ef_1')?.eraName).toBe('Age of Ash')
    expect(eraFlipsStore.getEraFlips().size).toBe(2)
  })

  it('no-ops a patch for a non-held branch', () => {
    eraFlipsStore.__reset()
    eraFlipsStore.hydrate('br_1', [])
    eraFlipsStore.patch('br_2', { op: 'create', id: 'ef_9', row: flipRow('ef_9', 9000, 'Ghost') })
    expect(eraFlipsStore.getById('ef_9')).toBeUndefined()
  })
})
