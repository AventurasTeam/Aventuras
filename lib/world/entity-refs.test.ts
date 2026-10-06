import { describe, expect, it } from 'vitest'

import {
  emptyEntityState,
  type CharacterRelationship,
  type Entity,
  type EntityKind,
  type EntityState,
  type HappeningAwareness,
  type HappeningInvolvement,
} from '@/lib/db'

import {
  entityLinkRows,
  referencingEntities,
  stateWithRefRewritten,
  unheldItemsWithout,
} from './entity-refs'

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

const REF_FIELDS: {
  field: string
  kind: EntityKind
  state: Partial<EntityState>
  rewritten: Partial<EntityState>
  cleared: Partial<EntityState>
}[] = [
  {
    field: 'current_location_id',
    kind: 'character',
    state: { current_location_id: 'old' },
    rewritten: { current_location_id: 'new' },
    cleared: { current_location_id: null },
  },
  {
    field: 'faction_id',
    kind: 'character',
    state: { faction_id: 'old' },
    rewritten: { faction_id: 'new' },
    cleared: { faction_id: null },
  },
  {
    field: 'equipped_items',
    kind: 'character',
    state: { equipped_items: ['item_a', 'old'] },
    rewritten: { equipped_items: ['item_a', 'new'] },
    cleared: { equipped_items: ['item_a'] },
  },
  {
    field: 'inventory',
    kind: 'character',
    state: { inventory: ['old', 'item_a'] },
    rewritten: { inventory: ['new', 'item_a'] },
    cleared: { inventory: ['item_a'] },
  },
  {
    field: 'parent_location_id',
    kind: 'location',
    state: { parent_location_id: 'old' },
    rewritten: { parent_location_id: 'new' },
    cleared: { parent_location_id: null },
  },
  {
    field: 'at_location_id',
    kind: 'item',
    state: { at_location_id: 'old' },
    rewritten: { at_location_id: 'new' },
    cleared: { at_location_id: null },
  },
]

describe('stateWithRefRewritten', () => {
  it.each(REF_FIELDS)('points $field at the new id', ({ kind, state, rewritten }) => {
    expect(stateWithRefRewritten(entity('e_1', kind, state), 'old', 'new')).toEqual({
      ...emptyEntityState(kind),
      ...state,
      ...rewritten,
    })
  })

  it.each(REF_FIELDS)('clears $field when the new id is null', ({ kind, state, cleared }) => {
    expect(stateWithRefRewritten(entity('e_1', kind, state), 'old', null)).toEqual({
      ...emptyEntityState(kind),
      ...state,
      ...cleared,
    })
  })

  it.each(REF_FIELDS)(
    'clears $field on the entity the ref would point at',
    ({ kind, state, cleared }) => {
      expect(stateWithRefRewritten(entity('new', kind, state), 'old', 'new')).toEqual({
        ...emptyEntityState(kind),
        ...state,
        ...cleared,
      })
    },
  )

  it('rewrites every ref field a character holds in one state', () => {
    const holder = entity('char_1', 'character', {
      current_location_id: 'old',
      faction_id: 'old',
      equipped_items: ['old'],
      traits: ['wary'],
    })
    expect(stateWithRefRewritten(holder, 'old', 'new')).toMatchObject({
      current_location_id: 'new',
      faction_id: 'new',
      equipped_items: ['new'],
      traits: ['wary'],
    })
  })

  it('keeps the first place of an id the rewrite duplicates', () => {
    const holder = entity('char_1', 'character', { inventory: ['item_l', 'item_c'] })
    expect(stateWithRefRewritten(holder, 'item_l', 'item_c')).toMatchObject({
      inventory: ['item_c'],
    })
  })

  it('holds a merged item once across equipped and inventory, equipped first', () => {
    const equipsLoser = entity('char_1', 'character', {
      equipped_items: ['item_l'],
      inventory: ['item_c', 'item_x'],
    })
    expect(stateWithRefRewritten(equipsLoser, 'item_l', 'item_c')).toMatchObject({
      equipped_items: ['item_c'],
      inventory: ['item_x'],
    })
    const carriesLoser = entity('char_2', 'character', {
      equipped_items: ['item_c'],
      inventory: ['item_l'],
    })
    expect(stateWithRefRewritten(carriesLoser, 'item_l', 'item_c')).toMatchObject({
      equipped_items: ['item_c'],
      inventory: [],
    })
  })

  it('leaves other repeated ids alone when clearing, as delete always has', () => {
    const holder = entity('char_1', 'character', { inventory: ['item_a', 'item_a', 'old'] })
    expect(stateWithRefRewritten(holder, 'old', null)).toMatchObject({
      inventory: ['item_a', 'item_a'],
    })
  })

  it('returns null for an entity that never names the id, and for a faction', () => {
    const walker = entity('char_1', 'character', { current_location_id: 'loc_2' })
    expect(stateWithRefRewritten(walker, 'old', 'new')).toBeNull()
    expect(stateWithRefRewritten(entity('fac_1', 'faction'), 'old', 'new')).toBeNull()
  })
})

describe('referencingEntities', () => {
  it('lists the other entities naming the target, never the target itself', () => {
    const place = entity('loc_1', 'location', { parent_location_id: 'loc_1' })
    const child = entity('loc_2', 'location', { parent_location_id: 'loc_1' })
    const walker = entity('char_1', 'character', { current_location_id: 'loc_1' })
    const elsewhere = entity('char_2', 'character', { current_location_id: 'loc_9' })
    expect(
      referencingEntities('loc_1', [place, child, walker, elsewhere]).map((e) => e.id),
    ).toEqual(['loc_2', 'char_1'])
  })
})

describe('entityLinkRows', () => {
  it('collects the cascade link set on the branch, a relationship from either end', () => {
    const awareness = [
      { id: 'haw_1', branchId: 'b1', characterId: 'char_x', happeningId: 'hap_1' },
      { id: 'haw_2', branchId: 'b2', characterId: 'char_x', happeningId: 'hap_1' },
      { id: 'haw_3', branchId: 'b1', characterId: 'char_y', happeningId: 'hap_1' },
    ] as HappeningAwareness[]
    const involvements = [
      { id: 'hinv_1', branchId: 'b1', entityId: 'char_x', happeningId: 'hap_1' },
      { id: 'hinv_2', branchId: 'b2', entityId: 'char_x', happeningId: 'hap_1' },
    ] as HappeningInvolvement[]
    const relationships = [
      { id: 'rel_1', branchId: 'b1', aId: 'char_a', bId: 'char_x' },
      { id: 'rel_2', branchId: 'b1', aId: 'char_x', bId: 'char_z' },
      { id: 'rel_3', branchId: 'b2', aId: 'char_a', bId: 'char_x' },
      { id: 'rel_4', branchId: 'b1', aId: 'char_a', bId: 'char_z' },
    ] as CharacterRelationship[]
    const links = entityLinkRows({
      branchId: 'b1',
      id: 'char_x',
      awareness,
      involvements,
      relationships,
    })
    expect(links.awareness.map((r) => r.id)).toEqual(['haw_1'])
    expect(links.involvements.map((r) => r.id)).toEqual(['hinv_1'])
    expect(links.relationships.map((r) => r.id)).toEqual(['rel_1', 'rel_2'])
  })
})

describe('unheldItemsWithout', () => {
  it('counts only carried items that lie nowhere and that nobody else holds', () => {
    const holder = entity('char_1', 'character', {
      equipped_items: ['item_1'],
      inventory: ['item_2', 'item_3'],
    })
    const other = entity('char_2', 'character', { inventory: ['item_2'] })
    const items = [
      entity('item_1', 'item'),
      entity('item_2', 'item'),
      entity('item_3', 'item', { at_location_id: 'loc_1' }),
      entity('item_4', 'item'),
    ]
    expect(unheldItemsWithout('char_1', [holder, other, ...items])).toBe(1)
  })

  it('counts nothing for a holder that is not among the entities', () => {
    expect(unheldItemsWithout('char_9', [entity('item_1', 'item')])).toBe(0)
  })
})
