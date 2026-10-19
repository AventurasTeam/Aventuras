import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  buildEntityViews,
  emptyEntityView,
  type CharacterStateView,
  type FactionStateView,
  type ItemStateView,
  type LocationStateView,
  type ViewScene,
} from './entity-views'

const NO_SCENE: ViewScene = { sceneEntities: [], currentLocationId: null }

const character = (id: string, name: string, state: object, overrides: Partial<Entity> = {}) =>
  makeEntity({ id, kind: 'character', name, state: state as Entity['state'], ...overrides })
const location = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
) => makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })
const item = (id: string, name: string, state: object = {}, overrides: Partial<Entity> = {}) =>
  makeEntity({
    id,
    kind: 'item',
    name,
    state: { at_location_id: null, ...state } as Entity['state'],
    ...overrides,
  })
const faction = (id: string, name: string, state: object = {}, overrides: Partial<Entity> = {}) =>
  makeEntity({ id, kind: 'faction', name, state: state as Entity['state'], ...overrides })

const characterOf = (entities: Entity[], id: string, scene = NO_SCENE) =>
  buildEntityViews(entities, scene).byId.get(id) as CharacterStateView
const itemOf = (entities: Entity[], id: string, scene = NO_SCENE) =>
  buildEntityViews(entities, scene).byId.get(id) as ItemStateView
const locationOf = (entities: Entity[], id: string, scene = NO_SCENE) =>
  buildEntityViews(entities, scene).byId.get(id) as LocationStateView
const factionOf = (entities: Entity[], id: string, scene = NO_SCENE) =>
  buildEntityViews(entities, scene).byId.get(id) as FactionStateView

describe('buildEntityViews — every kind', () => {
  it('projects a character: visuals, lists, voice and resolved references', () => {
    const entities = [
      character('char_k', 'Kael', {
        visual: { physique: ' tall ', hair: '', attire: 'a greatcoat' },
        traits: ['wary', ' ', 'loyal'],
        drives: ['clear his name'],
        voice: 'clipped',
        faction_id: 'fact_h',
        current_location_id: 'loc_d',
        inventory: [],
        equipped_items: [],
        stackables: { gold: 30, arrows: 12 },
      }),
      faction('fact_h', 'The Silver Hand'),
      location('loc_d', 'The Docks', null),
    ]
    expect(characterOf(entities, 'char_k')).toEqual({
      visual: {
        physique: 'tall',
        face: null,
        hair: null,
        eyes: null,
        attire: 'a greatcoat',
        distinguishing: null,
      },
      traits: ['wary', 'loyal'],
      drives: ['clear his name'],
      voice: 'clipped',
      faction: { id: 'fact_h', name: 'The Silver Hand', status: 'active' },
      location: { id: 'loc_d', name: 'The Docks', status: 'active' },
      holdings: [],
      stackables: [
        { key: 'gold', amount: 30 },
        { key: 'arrows', amount: 12 },
      ],
    })
  })

  it('projects a location, an item and a faction', () => {
    const entities = [
      location('loc_p', 'Port Vellis', null),
      location('loc_a', 'The Anchor', 'loc_p', {
        state: { parent_location_id: 'loc_p', condition: 'half-burned' },
      }),
      item('item_s', 'Sword', { condition: 'notched', at_location_id: 'loc_a' }),
      faction('fact_h', 'The Silver Hand', {
        standing: 'ascendant',
        agenda: ['take the port', ''],
      }),
      character('char_k', 'Kael', { faction_id: 'fact_h' }),
    ]
    expect(locationOf(entities, 'loc_a')).toEqual({
      condition: 'half-burned',
      parent: { id: 'loc_p', name: 'Port Vellis', status: 'active' },
    })
    expect(itemOf(entities, 'item_s')).toEqual({
      condition: 'notched',
      location: { id: 'loc_a', name: 'The Anchor', status: 'active' },
      holder: null,
    })
    expect(factionOf(entities, 'fact_h')).toEqual({
      standing: 'ascendant',
      agenda: ['take the port'],
      members: [{ id: 'char_k', name: 'Kael', status: 'active' }],
    })
  })

  it.each(['character', 'location', 'item', 'faction'] as const)(
    'gives a %s with no stored state the empty view',
    (kind) => {
      const row = makeEntity({ id: 'x_1', kind, name: 'Nothing', state: null })
      expect(buildEntityViews([row], NO_SCENE).byId.get('x_1')).toEqual(emptyEntityView(kind))
    },
  )
})

describe('buildEntityViews — holdings, holder, members, stackables', () => {
  const holder = (state: object, overrides: Partial<Entity> = {}) =>
    character('char_k', 'Kael', { inventory: [], equipped_items: [], ...state }, overrides)

  it('lists inventory then equipped items, one entry for an id in both, as equipped', () => {
    const entities = [
      holder({ inventory: ['item_b', 'item_a'], equipped_items: ['item_b', 'item_c'] }),
      item('item_a', 'Key', { condition: 'bent' }, { description: 'opens the vault' }),
      item('item_b', 'Sabre'),
      item('item_c', 'Lantern'),
    ]
    expect(characterOf(entities, 'char_k').holdings).toEqual([
      {
        id: 'item_a',
        name: 'Key',
        status: 'active',
        description: 'opens the vault',
        condition: 'bent',
        equipped: false,
      },
      {
        id: 'item_b',
        name: 'Sabre',
        status: 'active',
        description: null,
        condition: null,
        equipped: true,
      },
      {
        id: 'item_c',
        name: 'Lantern',
        status: 'active',
        description: null,
        condition: null,
        equipped: true,
      },
    ])
  })

  it('keeps a staged item, lists a repeated id once, and reads null arrays as holding nothing', () => {
    const chart = item('item_c', 'sea chart', {}, { status: 'staged' })
    expect(
      characterOf([holder({ inventory: ['item_c', 'item_c'] }), chart], 'char_k').holdings,
    ).toEqual([
      {
        id: 'item_c',
        name: 'sea chart',
        status: 'staged',
        description: null,
        condition: null,
        equipped: false,
      },
    ])
    const nulled = holder({ inventory: null, equipped_items: null })
    expect(characterOf([nulled, chart], 'char_k').holdings).toEqual([])
    const sparse = character('char_k', 'Kael', { inventory: ['item_c'] })
    expect(characterOf([sparse, chart], 'char_k').holdings.map((h) => h.id)).toEqual(['item_c'])
  })

  it('gives an item its holder, equipped or not, from the holder side', () => {
    const entities = [holder({ equipped_items: ['item_s'] }), item('item_s', 'Sabre')]
    expect(itemOf(entities, 'item_s').holder).toEqual({
      id: 'char_k',
      name: 'Kael',
      status: 'active',
      equipped: true,
    })
  })

  it('prefers an active in-scene holder for an item an older write left doubled', () => {
    const entities = [
      character('char_a', 'Aria', { inventory: ['item_s'] }),
      character('char_z', 'Zev', { inventory: ['item_s'] }),
      item('item_s', 'Sabre'),
    ]
    expect(itemOf(entities, 'item_s').holder?.id).toBe('char_a')
    const scene = { sceneEntities: ['char_z'], currentLocationId: null }
    expect(itemOf(entities, 'item_s', scene).holder?.id).toBe('char_z')
  })

  it('lists a faction’s members by name, keeping retired ones', () => {
    const entities = [
      faction('fact_h', 'The Silver Hand'),
      character('char_z', 'Zev', { faction_id: 'fact_h' }, { status: 'retired' }),
      character('char_a', 'Aria', { faction_id: 'fact_h' }),
      character('char_o', 'Orin', { faction_id: 'fact_x' }),
    ]
    expect(factionOf(entities, 'fact_h').members).toEqual([
      { id: 'char_a', name: 'Aria', status: 'active' },
      { id: 'char_z', name: 'Zev', status: 'retired' },
    ])
  })

  it('folds stackable keys the way a transfer reads them, largest first', () => {
    const entities = [holder({ stackables: { Gold: 5, gold: 3, arrows: 12, rope: 0, ' ': 4 } })]
    expect(characterOf(entities, 'char_k').stackables).toEqual([
      { key: 'arrows', amount: 12 },
      { key: 'gold', amount: 8 },
    ])
  })
})

describe('buildEntityViews — who a reference names', () => {
  it('drops a reference whose target is missing or of another kind', () => {
    const entities = [
      character('char_k', 'Kael', {
        faction_id: 'loc_d',
        current_location_id: 'fact_gone',
        inventory: ['char_k', 'item_gone'],
      }),
      location('loc_d', 'The Docks', null),
    ]
    const view = characterOf(entities, 'char_k')
    expect(view.faction).toBeNull()
    expect(view.location).toBeNull()
    expect(view.holdings).toEqual([])
  })

  it('leaves out a disabled faction, so its members have none', () => {
    const entities = [
      character('char_k', 'Kael', { faction_id: 'fact_h' }),
      faction('fact_h', 'The Silver Hand', {}, { injectionMode: 'disabled' }),
    ]
    const scene = { sceneEntities: ['char_k'], currentLocationId: null }
    expect(characterOf(entities, 'char_k', scene).faction).toBeNull()
    // Positive control: the same faction enabled is named.
    entities[1] = faction('fact_h', 'The Silver Hand')
    expect(characterOf(entities, 'char_k', scene).faction?.name).toBe('The Silver Hand')
  })

  it('leaves out a disabled held item, unless the scene seats it', () => {
    const entities = [
      character('char_k', 'Kael', { inventory: ['item_s'] }),
      item('item_s', 'Sabre', {}, { injectionMode: 'disabled' }),
    ]
    expect(characterOf(entities, 'char_k').holdings).toEqual([])
    const scene = { sceneEntities: ['char_k', 'item_s'], currentLocationId: null }
    expect(characterOf(entities, 'char_k', scene).holdings.map((h) => h.id)).toEqual(['item_s'])
  })

  it('does not let the scene seat a disabled held item that is not active', () => {
    const entities = [
      character('char_k', 'Kael', { inventory: ['item_s'] }),
      item('item_s', 'Sabre', {}, { injectionMode: 'disabled', status: 'staged' }),
    ]
    const scene = { sceneEntities: ['item_s'], currentLocationId: null }
    expect(characterOf(entities, 'char_k', scene).holdings).toEqual([])
  })

  it('leaves out a disabled holder and disabled members', () => {
    const entities = [
      character(
        'char_k',
        'Kael',
        { inventory: ['item_s'], faction_id: 'fact_h' },
        {
          injectionMode: 'disabled',
        },
      ),
      item('item_s', 'Sabre'),
      faction('fact_h', 'The Silver Hand'),
    ]
    expect(itemOf(entities, 'item_s').holder).toBeNull()
    expect(factionOf(entities, 'fact_h').members).toEqual([])
    const scene = { sceneEntities: ['char_k'], currentLocationId: null }
    expect(itemOf(entities, 'item_s', scene).holder?.id).toBe('char_k')
  })

  it('treats a place disabled through an ancestor as disabled', () => {
    const entities = [
      location('loc_r', 'The Rift', null, { injectionMode: 'disabled' }),
      location('loc_c', 'The Chapel', 'loc_r'),
      character('char_k', 'Kael', { current_location_id: 'loc_c' }),
      item('item_s', 'Sabre', { at_location_id: 'loc_c' }),
    ]
    expect(characterOf(entities, 'char_k').location).toBeNull()
    expect(itemOf(entities, 'item_s').location).toBeNull()
    // Positive control: with the ancestor enabled, the same place is named.
    entities[0] = location('loc_r', 'The Rift', null)
    expect(characterOf(entities, 'char_k').location?.name).toBe('The Chapel')
  })

  it('keeps the current location, whatever its mode, and puts an in-scene character there', () => {
    const entities = [
      location('loc_c', 'The Chapel', null, { injectionMode: 'disabled' }),
      location('loc_d', 'The Docks', null),
      character('char_k', 'Kael', { current_location_id: 'loc_d' }),
    ]
    const scene = { sceneEntities: ['char_k'], currentLocationId: 'loc_c' }
    expect(characterOf(entities, 'char_k', scene).location?.id).toBe('loc_c')
    // Out of the scene, the last-seen place.
    expect(characterOf(entities, 'char_k', { ...scene, sceneEntities: [] }).location?.id).toBe(
      'loc_d',
    )
  })

  it('leaves retired items out of holdings and the loose list, but keeps a retired faction', () => {
    const entities = [
      character('char_k', 'Kael', { inventory: ['item_s'], faction_id: 'fact_h' }),
      item('item_s', 'Sabre', {}, { status: 'retired' }),
      item('item_l', 'Lantern', { at_location_id: 'loc_d' }, { status: 'retired' }),
      faction('fact_h', 'The Silver Hand', {}, { status: 'retired' }),
      location('loc_d', 'The Docks', null),
    ]
    const views = buildEntityViews(entities, NO_SCENE)
    expect((views.byId.get('char_k') as CharacterStateView).holdings).toEqual([])
    expect(views.looseAt('loc_d')).toEqual([])
    expect((views.byId.get('char_k') as CharacterStateView).faction?.status).toBe('retired')
  })
})

describe('buildEntityViews — of', () => {
  it('reads a view by id and kind, and gives the empty view to a stranger or a kind mismatch', () => {
    const entities = [
      location('loc_a', 'The Anchor', null, {
        state: { parent_location_id: null, condition: 'burned' },
      }),
    ]
    const views = buildEntityViews(entities, NO_SCENE)
    expect(views.of('loc_a', 'location').condition).toBe('burned')
    expect(views.of('loc_a', 'item')).toEqual(emptyEntityView('item'))
    expect(views.of('loc_gone', 'location')).toEqual(emptyEntityView('location'))
  })

  it("kinded pairs each kind with that kind's own view, and nothing else", () => {
    const entities = [
      character('char_k', 'Kael', { voice: 'low' }),
      location('loc_a', 'The Anchor', null),
      item('item_s', 'Sabre'),
      faction('fact_h', 'The Silver Hand'),
    ]
    const views = buildEntityViews(entities, NO_SCENE)
    for (const e of entities) {
      const paired = views.kinded(e.id, e.kind)
      expect(paired).toEqual({ kind: e.kind, state: views.byId.get(e.id) })
      expect(paired.state).toBe(views.byId.get(e.id))
    }
    expect(views.kinded('loc_a', 'item')).toEqual({ kind: 'item', state: emptyEntityView('item') })
  })
})

describe('buildEntityViews — looseAt', () => {
  it('lists the items lying at a place by name, leaving out disabled ones the scene does not seat', () => {
    const entities = [
      location('loc_d', 'The Docks', null),
      item('item_r', 'Rope', { at_location_id: 'loc_d' }),
      item('item_c', 'Crate', { at_location_id: 'loc_d' }),
      item('item_x', 'Secret', { at_location_id: 'loc_d' }, { injectionMode: 'disabled' }),
      item('item_e', 'Elsewhere', { at_location_id: 'loc_z' }),
      item('item_s', 'Staged', { at_location_id: 'loc_d' }, { status: 'staged' }),
      character('char_b', 'Bosun', { current_location_id: 'loc_d' }),
    ]
    expect(buildEntityViews(entities, NO_SCENE).looseAt('loc_d')).toEqual([
      'item_c',
      'item_r',
      'item_s',
    ])
    const scene = { sceneEntities: ['item_x'], currentLocationId: 'loc_d' }
    expect(buildEntityViews(entities, scene).looseAt('loc_d')).toEqual([
      'item_c',
      'item_r',
      'item_x',
      'item_s',
    ])
  })
})
