import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity, type EntityKind, type EntityState } from '@/lib/db'

import { entityDeleteActions } from './entity-delete'

function entity(id: string, kind: EntityKind, state: Partial<EntityState> = {}): Entity {
  return {
    id,
    branchId: 'b1',
    kind,
    name: id,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: { ...emptyEntityState(kind), ...state } as EntityState,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('entityDeleteActions', () => {
  it('merges every ref an entity holds into one state patch and deletes last', () => {
    const target = entity('char_x', 'character')
    const other = entity('char_o', 'character', {
      current_location_id: 'char_x',
      inventory: ['char_x', 'item_1'],
    })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, other],
      tail: null,
    })

    expect(plan.actions).toHaveLength(2)
    expect(plan.actions[0]).toMatchObject({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'char_o',
        patch: { state: { current_location_id: null, inventory: ['item_1'] } },
      },
    })
    expect(plan.actions.at(-1)).toEqual({
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_x' },
    })
    expect(plan.references).toBe(1)
  })

  it('clears a deleted location from characters, child locations and items, and counts the items left unplaced', () => {
    const place = entity('loc_1', 'location')
    const child = entity('loc_2', 'location', { parent_location_id: 'loc_1' })
    const walker = entity('char_1', 'character', { current_location_id: 'loc_1' })
    const loose = entity('item_1', 'item', { at_location_id: 'loc_1' })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target: place,
      branchEntities: [place, child, walker, loose],
      tail: null,
    })
    const patched = plan.actions.filter((a) => a.kind === 'updateEntity').map((a) => a.payload.id)
    expect(patched.sort()).toEqual(['char_1', 'item_1', 'loc_2'])
    expect(plan.unplacedItems).toBe(1)
  })

  it('counts a deleted holder’s items unplaced unless another character also holds them', () => {
    const holder = entity('char_1', 'character', { inventory: ['item_1', 'item_2'] })
    const other = entity('char_2', 'character', { equipped_items: ['item_2'] })
    const items = [entity('item_1', 'item'), entity('item_2', 'item')]
    const plan = entityDeleteActions({
      branchId: 'b1',
      target: holder,
      branchEntities: [holder, other, ...items],
      tail: null,
    })
    expect(plan.unplacedItems).toBe(1)
    expect(plan.references).toBe(0)
  })

  it('drops the id from the tail scene and clears it as the current location', () => {
    const place = entity('loc_1', 'location')
    const plan = entityDeleteActions({
      branchId: 'b1',
      target: place,
      branchEntities: [place],
      tail: { id: 'entry_9', sceneEntities: ['char_1', 'loc_1'], currentLocationId: 'loc_1' },
    })
    expect(plan.actions[0]).toEqual({
      kind: 'updateStoryEntryMetadata',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'entry_9',
        metadata: { sceneEntities: ['char_1'], currentLocationId: null },
      },
    })
    expect(plan.tailScene).toBe(true)
  })

  it('writes no tail action when the tail never named the id', () => {
    const target = entity('char_x', 'character')
    const plan = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target],
      tail: { id: 'entry_9', sceneEntities: ['char_1'], currentLocationId: 'loc_1' },
    })
    expect(plan.actions.map((a) => a.kind)).toEqual(['deleteEntity'])
    expect(plan.tailScene).toBe(false)
  })

  it('clears a deleted faction from its members', () => {
    const faction = entity('fact_1', 'faction')
    const member = entity('char_1', 'character', { faction_id: 'fact_1' })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target: faction,
      branchEntities: [faction, member],
      tail: null,
    })
    expect(plan.actions[0]).toMatchObject({
      payload: { id: 'char_1', patch: { state: { faction_id: null } } },
    })
  })
})
