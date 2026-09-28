import { describe, expect, it } from 'vitest'

import { deleteUndoHint } from '@/components/compounds/delete-confirm-copy'
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

describe('entityDeleteImpact', () => {
  it('names two awareness rows, one involvement, one relationship (bId side) and the tail-scene drop, ignoring off-branch rows', () => {
    const impact = entityDeleteImpact({
      branchId: 'b1',
      row: mira,
      entities: [mira],
      entries: [tail],
      awareness: [
        { id: 'haw_1', branchId: 'b1', characterId: 'char_mira', happeningId: 'hap_1' },
        { id: 'haw_2', branchId: 'b1', characterId: 'char_mira', happeningId: 'hap_2' },
        { id: 'haw_x', branchId: 'b2', characterId: 'char_mira', happeningId: 'hap_x' },
      ] as never,
      involvements: [
        { id: 'hinv_1', branchId: 'b1', entityId: 'char_mira', happeningId: 'hap_1' },
        { id: 'hinv_x', branchId: 'b2', entityId: 'char_mira', happeningId: 'hap_x' },
      ] as never,
      relationships: [
        { id: 'rel_1', branchId: 'b1', aId: 'char_kael', bId: 'char_mira' },
        { id: 'rel_x', branchId: 'b2', aId: 'char_kael', bId: 'char_mira' },
      ] as never,
    })
    expect(impact).toEqual({
      awareness: 2,
      involvements: 1,
      relationships: 1,
      references: 0,
      unplacedItems: 0,
      tailScene: true,
    })
    expect(entityDeleteCopy(mira, impact)).toEqual({
      title: 'Delete Mira?',
      description: deleteUndoHint(),
      impacts: [
        '2 awareness records',
        '1 happening involvement',
        '1 relationship',
        'Removed from the current scene',
      ],
      confirmLabel: 'Delete character',
    })
  })

  it('counts a relationship where the target is the aId side, not only bId', () => {
    const impact = entityDeleteImpact({
      branchId: 'b1',
      row: mira,
      entities: [mira],
      entries: [],
      awareness: [],
      involvements: [],
      relationships: [{ id: 'rel_2', branchId: 'b1', aId: 'char_mira', bId: 'char_kael' }] as never,
    })
    expect(impact.relationships).toBe(1)
  })

  it("counts a deleted location's standing characters as references and its unheld item as unplaced", () => {
    const hollow = {
      id: 'loc_hollow',
      branchId: 'b1',
      kind: 'location',
      name: 'Veil’s Hollow',
      state: emptyEntityState('location'),
    } as Entity
    const kael = {
      id: 'char_kael',
      branchId: 'b1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), current_location_id: 'loc_hollow' },
    } as Entity
    const vorne = {
      id: 'char_vorne',
      branchId: 'b1',
      kind: 'character',
      name: 'Vorne',
      state: { ...emptyEntityState('character'), current_location_id: 'loc_hollow' },
    } as Entity
    const key = {
      id: 'item_key',
      branchId: 'b1',
      kind: 'item',
      name: 'Old key',
      state: { at_location_id: 'loc_hollow' },
    } as Entity
    const impact = entityDeleteImpact({
      branchId: 'b1',
      row: hollow,
      entities: [hollow, kael, vorne, key],
      entries: [],
      awareness: [],
      involvements: [],
      relationships: [],
    })
    // Distinct non-zero counts catch a references/unplacedItems mix-up: the item counts twice —
    // it loses its link (a reference, like the two characters) and ends up unplaced too.
    expect(impact.references).toBe(3)
    expect(impact.unplacedItems).toBe(1)
    expect(entityDeleteCopy(hollow, impact).impacts).toEqual([
      '3 other entities lose their link to it',
      '1 item will have no position',
    ])
  })
})
