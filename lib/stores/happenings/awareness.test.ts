import { describe, expect, it } from 'vitest'

import type { HappeningAwareness } from '@/lib/db'

import { happeningAwarenessStore } from './awareness'

function row(
  id: string,
  happeningId: string,
  characterId: string,
  branchId = 'br_1',
): HappeningAwareness {
  return {
    id,
    branchId,
    happeningId,
    characterId,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

describe('happeningAwarenessStore', () => {
  it('filters by happening and by character', () => {
    happeningAwarenessStore.__reset()
    happeningAwarenessStore.hydrate('br_1', [
      row('haw_1', 'hap_1', 'char_a'),
      row('haw_2', 'hap_1', 'char_b'),
      row('haw_3', 'hap_2', 'char_a'),
    ])
    expect(happeningAwarenessStore.getByHappening('br_1', 'hap_1').length).toBe(2)
    expect(happeningAwarenessStore.getByCharacter('br_1', 'char_a').length).toBe(2)
  })

  it('reads nothing by happening or character for a branch it does not hold', () => {
    happeningAwarenessStore.__reset()
    happeningAwarenessStore.hydrate('br_1', [row('haw_1', 'hap_1', 'char_a')])
    expect(happeningAwarenessStore.getByHappening('br_2', 'hap_1')).toEqual([])
    expect(happeningAwarenessStore.getByCharacter('br_2', 'char_a')).toEqual([])
    expect(happeningAwarenessStore.getByHappening(null, 'hap_1')).toEqual([])
    expect(happeningAwarenessStore.getByCharacter(null, 'char_a')).toEqual([])

    happeningAwarenessStore.hydrate('br_2', [row('haw_1', 'hap_1', 'char_a', 'br_2')])
    expect(happeningAwarenessStore.getByHappening('br_1', 'hap_1')).toEqual([])
    expect(happeningAwarenessStore.getByCharacter('br_1', 'char_a')).toEqual([])
    expect(happeningAwarenessStore.getByHappening('br_2', 'hap_1').map((r) => r.branchId)).toEqual([
      'br_2',
    ])
  })

  it('no-ops a patch for a non-held branch', () => {
    happeningAwarenessStore.__reset()
    happeningAwarenessStore.hydrate('br_1', [])
    happeningAwarenessStore.patch('br_2', {
      op: 'create',
      id: 'haw_9',
      row: row('haw_9', 'hap_9', 'char_z'),
    })
    expect(happeningAwarenessStore.getById('haw_9')).toBeUndefined()
  })
})
