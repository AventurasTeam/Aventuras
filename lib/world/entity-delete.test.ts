import { describe, expect, it } from 'vitest'

import {
  emptyEntityState,
  entityStateSchemaForKind,
  type Entity,
  type EntityKind,
  type EntityState,
} from '@/lib/db'

import { FLAG_CLEAR } from './collision-flags'
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
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
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
      faction_id: 'fact_1',
      equipped_items: ['char_x'],
      inventory: ['char_x', 'item_1'],
      traits: ['brave'],
      drives: ['revenge'],
      voice: 'gravelly',
      visual: { physique: 'tall', hair: 'black' },
      stackables: { gold: 5 },
      lastSeenAt: { entryId: 'entry_1', locationId: 'loc_1', worldTime: 3 },
    })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, other],
      tail: null,
    })

    expect(plan.actions).toHaveLength(2)
    expect(plan.actions[0]).toEqual({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'char_o',
        patch: {
          state: {
            visual: { physique: 'tall', hair: 'black' },
            traits: ['brave'],
            drives: ['revenge'],
            voice: 'gravelly',
            current_location_id: null,
            equipped_items: [],
            inventory: ['item_1'],
            stackables: { gold: 5 },
            faction_id: 'fact_1',
            lastSeenAt: { entryId: 'entry_1', locationId: 'loc_1', worldTime: 3 },
          },
        },
      },
    })
    expect(plan.actions.at(-1)).toEqual({
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_x' },
    })
    expect(plan.references).toBe(1)
  })

  it('fills a legacy character state missing lastSeenAt before clearing its ref, keeping the patch schema-valid', () => {
    const target = entity('char_x', 'character')
    const legacy: Entity = {
      ...entity('char_o', 'character'),
      // Predates the lastSeenAt field: a raw stored state, never merged over emptyEntityState.
      state: {
        current_location_id: 'char_x',
        equipped_items: [],
        inventory: [],
        traits: [],
        drives: [],
        visual: {},
        faction_id: null,
      } as unknown as EntityState,
    }
    const plan = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, legacy],
      tail: null,
    })
    const update = plan.actions.find((a) => a.kind === 'updateEntity')
    expect(update).toBeDefined()
    expect(
      entityStateSchemaForKind('character').safeParse(
        (update as { payload: { patch: { state: unknown } } }).payload.patch.state,
      ).success,
    ).toBe(true)
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
    const updates = plan.actions.filter((a) => a.kind === 'updateEntity')
    expect(updates.map((a) => a.payload.id).sort()).toEqual(['char_1', 'item_1', 'loc_2'])
    expect(updates.find((a) => a.payload.id === 'loc_2')).toMatchObject({
      payload: { patch: { state: { parent_location_id: null } } },
    })
    expect(updates.find((a) => a.payload.id === 'item_1')).toMatchObject({
      payload: { patch: { state: { at_location_id: null } } },
    })
    expect(updates.find((a) => a.payload.id === 'char_1')).toMatchObject({
      payload: { patch: { state: { current_location_id: null } } },
    })
    expect(plan.unplacedItems).toBe(1)
  })

  it('does not count an item at a deleted location that a surviving character also holds', () => {
    const place = entity('loc_1', 'location')
    const survivor = entity('char_1', 'character', { equipped_items: ['item_1'] })
    const carried = entity('item_1', 'item', { at_location_id: 'loc_1' })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target: place,
      branchEntities: [place, survivor, carried],
      tail: null,
    })
    expect(plan.unplacedItems).toBe(0)
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
    expect(plan.references).toBe(0)
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

describe('entityDeleteActions — collision flags naming it', () => {
  const named = (
    id: string,
    kind: EntityKind,
    name: string,
    partnerId: string | null,
    state: Partial<EntityState> = {},
  ): Entity => ({
    ...entity(id, kind, state),
    name,
    nameCollisionFlag: partnerId == null ? 0 : 1,
    nameCollisionPartnerId: partnerId,
    nameCollisionReason: partnerId == null ? null : 'distinct',
  })
  const deleteOf = (id: string) => ({
    kind: 'deleteEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id },
  })

  it('clears the flag of a row whose partner is the target, before the delete', () => {
    const target = named('char_x', 'character', 'Kael', null)
    const twin = named('char_t', 'character', 'Kael Stormborn', 'char_x')
    expect(
      entityDeleteActions({ branchId: 'b1', target, branchEntities: [target, twin], tail: null })
        .actions,
    ).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_t', patch: FLAG_CLEAR },
      },
      deleteOf('char_x'),
    ])
  })

  it('folds the clear into the ref patch of a row that named the target', () => {
    const target = named('loc_a', 'location', 'Hollow', null)
    const child = named('loc_b', 'location', 'Hollow', 'loc_a', { parent_location_id: 'loc_a' })
    const plan = entityDeleteActions({
      branchId: 'b1',
      target,
      branchEntities: [target, child],
      tail: null,
    })
    expect(plan.actions[0]).toStrictEqual({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        id: 'loc_b',
        patch: { state: { parent_location_id: null }, ...FLAG_CLEAR },
      },
    })
    expect(plan.actions).toHaveLength(2)
    expect(plan.references).toBe(1)
  })

  it('clears it even while a same-name third row remains', () => {
    const target = named('char_x', 'character', 'Kael', null)
    const twin = named('char_t', 'character', 'Kael', 'char_x')
    const third = named('char_u', 'character', 'Kael', null)
    expect(
      entityDeleteActions({
        branchId: 'b1',
        target,
        branchEntities: [target, twin, third],
        tail: null,
      }).actions.map((a) => a.payload),
    ).toStrictEqual([
      { branchId: 'b1', id: 'char_t', patch: FLAG_CLEAR },
      { branchId: 'b1', id: 'char_x' },
    ])
  })

  it('leaves a flag naming another row, a namesake of the target, or a row already gone', () => {
    const target = named('char_x', 'character', 'Kael', null)
    const twin = named('char_t', 'character', 'Kael', 'char_u')
    const third = named('char_u', 'character', 'Kael', null)
    const dormant = named('char_d', 'character', 'Kael', 'char_gone')
    expect(
      entityDeleteActions({
        branchId: 'b1',
        target,
        branchEntities: [target, twin, third, dormant],
        tail: null,
      }).actions,
    ).toStrictEqual([deleteOf('char_x')])
  })
})
