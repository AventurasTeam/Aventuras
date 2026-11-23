import { describe, expect, it } from 'vitest'

import type { CharacterRelationship } from '@/lib/db'

import { characterRelationshipsStore } from './character-relationships'

function row(
  id: string,
  aId: string,
  bId: string,
  kind: string | null,
  inverseKind: string | null,
): CharacterRelationship {
  return { id, branchId: 'br_1', aId, bId, kind, inverseKind, createdAt: 1, updatedAt: 1 }
}

describe('characterRelationshipsStore', () => {
  it('getRelationships returns each row from the queried character POV', () => {
    characterRelationshipsStore.__reset()
    // canonical a < b: char_aria < char_kael
    characterRelationshipsStore.hydrate('br_1', [
      row('rel_1', 'char_aria', 'char_kael', 'brother', 'sister'),
    ])

    const ariaView = characterRelationshipsStore.getRelationships('char_aria', 'br_1')
    expect(ariaView).toEqual([
      { rowId: 'rel_1', otherId: 'char_kael', selfToOther: 'brother', otherToSelf: 'sister' },
    ])

    const kaelView = characterRelationshipsStore.getRelationships('char_kael', 'br_1')
    expect(kaelView).toEqual([
      { rowId: 'rel_1', otherId: 'char_aria', selfToOther: 'sister', otherToSelf: 'brother' },
    ])
  })

  it('getRelationships returns [] for a non-held branch', () => {
    characterRelationshipsStore.__reset()
    characterRelationshipsStore.hydrate('br_1', [
      row('rel_1', 'char_aria', 'char_kael', 'brother', 'sister'),
    ])
    expect(characterRelationshipsStore.getRelationships('char_aria', 'br_2')).toEqual([])
  })

  it('no-ops a patch for a non-held branch', () => {
    characterRelationshipsStore.__reset()
    characterRelationshipsStore.hydrate('br_1', [])
    characterRelationshipsStore.patch('br_2', {
      op: 'create',
      id: 'rel_9',
      row: row('rel_9', 'char_a', 'char_b', 'ally', null),
    })
    expect(characterRelationshipsStore.getById('br_1', 'rel_9')).toBeUndefined()
  })
})
