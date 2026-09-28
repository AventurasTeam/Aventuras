import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity, type StoryEntry } from '@/lib/db'

import { entityDeleteCopy } from './delete-copy'
import { entityDeleteImpact } from './delete-impact'

const mira = {
  id: 'char_mira',
  branchId: 'b1',
  kind: 'character',
  name: 'Mira',
  state: emptyEntityState('character'),
} as Entity
const tail = {
  id: 'entry_9',
  branchId: 'b1',
  kind: 'ai_reply',
  position: 9,
  metadata: { sceneEntities: ['char_mira'], currentLocationId: null, worldTime: 0 },
} as StoryEntry

describe('entity delete confirm', () => {
  it('names two awareness rows, one involvement, one relationship and the tail-scene drop', () => {
    const impact = entityDeleteImpact({
      branchId: 'b1',
      row: mira,
      entities: [mira],
      entries: [tail],
      awareness: [
        { id: 'haw_1', branchId: 'b1', characterId: 'char_mira', happeningId: 'hap_1' },
        { id: 'haw_2', branchId: 'b1', characterId: 'char_mira', happeningId: 'hap_2' },
      ] as never,
      involvements: [
        { id: 'hinv_1', branchId: 'b1', entityId: 'char_mira', happeningId: 'hap_1' },
      ] as never,
      relationships: [{ id: 'rel_1', branchId: 'b1', aId: 'char_kael', bId: 'char_mira' }] as never,
    })
    expect(entityDeleteCopy(mira, impact)).toEqual({
      title: 'Delete Mira?',
      description: "You can undo this from the reader with Ctrl+Z (Undo in the reader's menu).",
      impacts: [
        '2 awareness records',
        '1 happening involvement',
        '1 relationship',
        'Removed from the current scene',
      ],
      confirmLabel: 'Delete character',
    })
  })
})
