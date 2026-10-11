import { describe, expect, it } from 'vitest'

import { emptyEntityState, type CharacterState, type Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  buildLocationMap,
  heldItemLines,
  listedAncestorNames,
  looseItemLines,
} from './location-map'

const location = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })
const item = (
  id: string,
  name: string,
  at: string | null,
  overrides: Partial<Entity> = {},
): Entity => makeEntity({ id, kind: 'item', name, state: { at_location_id: at }, ...overrides })
const holder = (held: Partial<Pick<CharacterState, 'inventory' | 'equipped_items'>>): Entity =>
  makeEntity({
    id: 'char_kael',
    kind: 'character',
    name: 'Kael',
    state: { ...emptyEntityState('character'), ...held },
  })

// Each row as the template indents it, so a wrong depth or order reads at a glance.
const outline = (rows: readonly { name: string; depth: number }[]): string[] =>
  rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`)

const ELDRA = location('loc_eldra', 'Eldra', null)
const VELLIS = location('loc_vellis', 'Port Vellis', 'loc_eldra')
const ANCHOR = location('loc_anchor', 'The Rusty Anchor', 'loc_vellis')
const BACK_ROOM = location('loc_back', 'the back room', 'loc_anchor')
const MARKET = location('loc_market', 'Harbor Market', 'loc_vellis')
const THORNWOOD = location('loc_thorn', 'Thornwood', null)
// Children before their parents: the map must not depend on input order.
const WORLD = [BACK_ROOM, THORNWOOD, MARKET, ANCHOR, VELLIS, ELDRA]

const RETIRED_VELLIS: Entity = { ...VELLIS, status: 'retired' }
const DISABLED_VELLIS: Entity = { ...VELLIS, injectionMode: 'disabled' }

describe('buildLocationMap', () => {
  it('nests every location under its parent in pre-order, siblings by name', () => {
    expect(buildLocationMap(WORLD, null)).toEqual([
      { id: 'loc_eldra', name: 'Eldra', depth: 0 },
      { id: 'loc_vellis', name: 'Port Vellis', depth: 1 },
      { id: 'loc_market', name: 'Harbor Market', depth: 2 },
      { id: 'loc_anchor', name: 'The Rusty Anchor', depth: 2 },
      { id: 'loc_back', name: 'the back room', depth: 3 },
      { id: 'loc_thorn', name: 'Thornwood', depth: 0 },
    ])
  })

  it('breaks a name tie by age, then by id', () => {
    const map = buildLocationMap(
      [
        location('loc_b', 'Mill', null, { createdAt: 5 }),
        location('loc_z', 'Mill', null, { createdAt: 2 }),
        location('loc_c', 'mill', null, { createdAt: 2 }),
      ],
      null,
    )
    expect(map.map((row) => row.id)).toEqual(['loc_c', 'loc_z', 'loc_b'])
  })

  it('lists a staged location', () => {
    const saltmere = location('loc_salt', 'Saltmere', 'loc_eldra', { status: 'staged' })
    expect(outline(buildLocationMap([ELDRA, saltmere], null))).toEqual(['Eldra', '  Saltmere'])
  })

  it('leaves a retired location out and hangs its children under the nearest listed ancestor', () => {
    expect(
      outline(buildLocationMap([ELDRA, RETIRED_VELLIS, ANCHOR, BACK_ROOM, MARKET], null)),
    ).toEqual(['Eldra', '  Harbor Market', '  The Rusty Anchor', '    the back room'])
  })

  it('leaves a disabled location out unless it is the current location', () => {
    expect(outline(buildLocationMap([ELDRA, DISABLED_VELLIS, MARKET], null))).toEqual([
      'Eldra',
      '  Harbor Market',
    ])
    expect(outline(buildLocationMap([ELDRA, DISABLED_VELLIS, MARKET], 'loc_vellis'))).toEqual([
      'Eldra',
      '  Port Vellis',
      '    Harbor Market',
    ])
  })

  it('leaves a retired current location out', () => {
    expect(outline(buildLocationMap([ELDRA, RETIRED_VELLIS], 'loc_vellis'))).toEqual(['Eldra'])
  })

  it('lists only locations, and roots one whose parent resolves to no row', () => {
    const entities = [
      location('loc_orphan', 'Orphan Quay', 'loc_gone'),
      makeEntity({ id: 'char_aldra', kind: 'character', name: 'Aldra' }),
      item('item_anvil', 'Anvil', null),
    ]
    expect(outline(buildLocationMap(entities, null))).toEqual(['Orphan Quay'])
  })

  // Ashgate and Bellmoor parent each other, Cinderfall hangs off them: none reaches a root.
  it('lists a chain looping through listed rows at the root, after the reachable tree', () => {
    const map = buildLocationMap(
      [
        THORNWOOD,
        location('loc_lc', 'Cinderfall', 'loc_la'),
        location('loc_lb', 'Bellmoor', 'loc_la'),
        location('loc_la', 'Ashgate', 'loc_lb'),
      ],
      null,
    )
    expect(outline(map)).toEqual(['Thornwood', 'Ashgate', 'Bellmoor', 'Cinderfall'])
  })

  it('returns no rows for a branch without locations', () => {
    expect(buildLocationMap([holder({})], null)).toEqual([])
  })
})

describe('listedAncestorNames', () => {
  it('names the listed ancestors, nearest first', () => {
    expect(listedAncestorNames('loc_back', WORLD)).toEqual([
      'The Rusty Anchor',
      'Port Vellis',
      'Eldra',
    ])
  })

  it('skips a retired or disabled ancestor', () => {
    expect(listedAncestorNames('loc_back', [ELDRA, RETIRED_VELLIS, ANCHOR, BACK_ROOM])).toEqual([
      'The Rusty Anchor',
      'Eldra',
    ])
    expect(listedAncestorNames('loc_back', [ELDRA, DISABLED_VELLIS, ANCHOR, BACK_ROOM])).toEqual([
      'The Rusty Anchor',
      'Eldra',
    ])
  })

  it('is empty at the root', () => {
    expect(listedAncestorNames('loc_eldra', WORLD)).toEqual([])
  })

  it('stops when the chain loops', () => {
    const loop = [location('loc_la', 'Ashgate', 'loc_lb'), location('loc_lb', 'Bellmoor', 'loc_la')]
    expect(listedAncestorNames('loc_la', loop)).toEqual(['Bellmoor'])
  })
})

describe('heldItemLines', () => {
  const KEY = item('item_key', 'Silver Key', null)
  const SWORD = item('item_sword', 'worn sword', null)
  const RING = item('item_ring', 'signet ring', null)

  it("lists inventory, then equipped items, as canon's Holds line reads", () => {
    const kael = holder({ inventory: ['item_key'], equipped_items: ['item_sword'] })
    expect(heldItemLines(kael, [KEY, SWORD])).toEqual([
      { id: 'item_key', name: 'Silver Key', equipped: false },
      { id: 'item_sword', name: 'worn sword', equipped: true },
    ])
  })

  it('shows an item in both arrays once, as equipped, in the equipped position', () => {
    const kael = holder({
      inventory: ['item_sword', 'item_key'],
      equipped_items: ['item_ring', 'item_sword'],
    })
    expect(heldItemLines(kael, [KEY, SWORD, RING])).toEqual([
      { id: 'item_key', name: 'Silver Key', equipped: false },
      { id: 'item_ring', name: 'signet ring', equipped: true },
      { id: 'item_sword', name: 'worn sword', equipped: true },
    ])
  })

  it('skips an id that is missing, not an item, or a retired item', () => {
    const kael = holder({ inventory: ['item_gone', 'loc_eldra', 'item_old', 'item_key'] })
    const oldCoin = item('item_old', 'old coin', null, { status: 'retired' })
    expect(heldItemLines(kael, [ELDRA, KEY, oldCoin])).toEqual([
      { id: 'item_key', name: 'Silver Key', equipped: false },
    ])
  })

  it('keeps a staged item, and lists a repeated id once', () => {
    const chart = item('item_chart', 'sea chart', null, { status: 'staged' })
    expect(heldItemLines(holder({ inventory: ['item_chart', 'item_chart'] }), [chart])).toEqual([
      { id: 'item_chart', name: 'sea chart', equipped: false },
    ])
  })

  it('is empty for a character holding nothing', () => {
    expect(heldItemLines(holder({}), [KEY])).toEqual([])
  })

  it('reads a stored state whose arrays are null or missing as holding nothing', () => {
    const nulled = { inventory: null, equipped_items: null } as unknown as Partial<CharacterState>
    expect(heldItemLines(holder(nulled), [KEY])).toEqual([])
    const sparse = makeEntity({
      id: 'char_kael',
      kind: 'character',
      name: 'Kael',
      state: { inventory: ['item_key'] } as unknown as Entity['state'],
    })
    expect(heldItemLines(sparse, [KEY])).toEqual([
      { id: 'item_key', name: 'Silver Key', equipped: false },
    ])
  })
})

describe('looseItemLines', () => {
  it('lists the unretired items lying at the location, by name', () => {
    const bosun = makeEntity({
      id: 'char_bosun',
      kind: 'character',
      name: 'Bosun',
      state: { ...emptyEntityState('character'), current_location_id: 'loc_anchor' },
    })
    const entities = [
      item('item_chest', 'the iron chest', 'loc_anchor'),
      item('item_candle', 'a candle', 'loc_anchor'),
      item('item_lamp', 'lamp', 'loc_anchor', { status: 'staged' }),
      item('item_rope', 'rope', 'loc_anchor', { status: 'retired' }),
      item('item_map', 'map', 'loc_market'),
      item('item_key', 'key', null),
      bosun,
    ]
    expect(looseItemLines('loc_anchor', entities)).toEqual([
      { id: 'item_candle', name: 'a candle' },
      { id: 'item_lamp', name: 'lamp' },
      { id: 'item_chest', name: 'the iron chest' },
    ])
  })

  it('is empty where nothing lies', () => {
    expect(looseItemLines('loc_thorn', [item('item_key', 'key', 'loc_anchor')])).toEqual([])
  })
})
