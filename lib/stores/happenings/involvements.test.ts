import { describe, expect, it } from 'vitest'

import type { HappeningInvolvement } from '@/lib/db'

import { happeningInvolvementsStore } from './involvements'

function row(
  id: string,
  happeningId: string,
  entityId: string,
  branchId = 'br_1',
): HappeningInvolvement {
  return { id, branchId, happeningId, entityId, role: null }
}

describe('happeningInvolvementsStore', () => {
  it('hydrates and filters by happening', () => {
    happeningInvolvementsStore.__reset()
    happeningInvolvementsStore.hydrate('br_1', [
      row('hinv_1', 'hap_1', 'char_1'),
      row('hinv_2', 'hap_1', 'loc_1'),
      row('hinv_3', 'hap_2', 'char_1'),
    ])
    expect(happeningInvolvementsStore.getByHappening('br_1', 'hap_1').length).toBe(2)
    expect(happeningInvolvementsStore.getById('hinv_3')?.entityId).toBe('char_1')
  })

  it('reads nothing by happening for a branch it does not hold', () => {
    happeningInvolvementsStore.__reset()
    happeningInvolvementsStore.hydrate('br_1', [row('hinv_1', 'hap_1', 'char_1')])
    expect(happeningInvolvementsStore.getByHappening('br_2', 'hap_1')).toEqual([])
    expect(happeningInvolvementsStore.getByHappening(null, 'hap_1')).toEqual([])

    happeningInvolvementsStore.hydrate('br_2', [row('hinv_1', 'hap_1', 'char_1', 'br_2')])
    expect(happeningInvolvementsStore.getByHappening('br_1', 'hap_1')).toEqual([])
    expect(
      happeningInvolvementsStore.getByHappening('br_2', 'hap_1').map((r) => r.branchId),
    ).toEqual(['br_2'])
  })

  it('no-ops a patch for a non-held branch', () => {
    happeningInvolvementsStore.__reset()
    happeningInvolvementsStore.hydrate('br_1', [])
    happeningInvolvementsStore.patch('br_2', {
      op: 'create',
      id: 'hinv_9',
      row: row('hinv_9', 'hap_9', 'char_9'),
    })
    expect(happeningInvolvementsStore.getById('hinv_9')).toBeUndefined()
  })
})
