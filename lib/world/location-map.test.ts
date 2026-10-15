import { describe, expect, it } from 'vitest'

import { emptyEntityState, type CharacterState, type Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  buildLocationMap,
  heldItemLines,
  listedAncestorNames,
  locationMapView,
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
const outline = (
  rows: readonly { name: string; depth: number; retired: boolean; retiredReason: string | null }[],
): string[] =>
  rows.map((row) => {
    const retired = row.retired
      ? ` (retired${row.retiredReason ? `: ${row.retiredReason}` : ''})`
      : ''
    return `${'  '.repeat(row.depth)}${row.name}${retired}`
  })

const listed = (id: string, name: string, depth: number) => ({
  retired: false,
  id,
  name,
  depth,
  retiredReason: null,
})

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
      listed('loc_eldra', 'Eldra', 0),
      listed('loc_vellis', 'Port Vellis', 1),
      listed('loc_market', 'Harbor Market', 2),
      listed('loc_anchor', 'The Rusty Anchor', 2),
      listed('loc_back', 'the back room', 3),
      listed('loc_thorn', 'Thornwood', 0),
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

  // piggyback.md → What the writer sees.
  it('lists a retired location without an id, followed by its reason', () => {
    const retired: Entity = { ...RETIRED_VELLIS, retiredReason: 'swallowed by the rift' }
    const map = buildLocationMap([ELDRA, retired, ANCHOR], null)
    expect(map[1]).toEqual({
      retired: true,
      id: null,
      name: 'Port Vellis',
      depth: 1,
      retiredReason: 'swallowed by the rift',
    })
    expect(outline(map)).toEqual([
      'Eldra',
      '  Port Vellis (retired: swallowed by the rift)',
      '    The Rusty Anchor',
    ])
  })

  // A reason that breaks a line would start a row at depth 0 and read as a top-level place.
  it("folds a retired reason's line breaks and runs of space into single spaces", () => {
    const retired: Entity = { ...RETIRED_VELLIS, retiredReason: ' swallowed\nby  the\r\n\trift\n' }
    const map = buildLocationMap([ELDRA, retired, ANCHOR], null)
    expect(outline(map).join('\n')).toBe(
      ['Eldra', '  Port Vellis (retired: swallowed by the rift)', '    The Rusty Anchor'].join(
        '\n',
      ),
    )
  })

  it('gives a retired location with a blank reason no reason', () => {
    const retired: Entity = { ...RETIRED_VELLIS, retiredReason: '  ' }
    expect(buildLocationMap([retired], null)[0]).toMatchObject({
      retired: true,
      retiredReason: null,
    })
  })

  it('lists a retired current location as retired', () => {
    expect(outline(buildLocationMap([ELDRA, RETIRED_VELLIS], 'loc_vellis'))).toEqual([
      'Eldra',
      '  Port Vellis (retired)',
    ])
  })

  it('leaves out a retired location that is effectively disabled', () => {
    const retiredDisabled: Entity = { ...RETIRED_VELLIS, injectionMode: 'disabled' }
    expect(outline(buildLocationMap([ELDRA, retiredDisabled], null))).toEqual(['Eldra'])
    expect(
      outline(
        buildLocationMap(
          [{ ...ELDRA, injectionMode: 'disabled' }, RETIRED_VELLIS, THORNWOOD],
          null,
        ),
      ),
    ).toEqual(['Thornwood'])
  })

  it('leaves a disabled location out with every place inside it', () => {
    expect(
      outline(buildLocationMap([...WORLD.filter((e) => e !== VELLIS), DISABLED_VELLIS], null)),
    ).toEqual(['Eldra', 'Thornwood'])
  })

  it('lists a disabled current location, and the places around a story inside it', () => {
    expect(outline(buildLocationMap([ELDRA, DISABLED_VELLIS, MARKET], 'loc_vellis'))).toEqual([
      'Eldra',
      '  Port Vellis',
      '    Harbor Market',
    ])
  })

  // A story inside a disabled region opens the places in it; the region itself stays off the map.
  it('hangs the places around a story inside a disabled region under the nearest listed ancestor', () => {
    const world = [ELDRA, DISABLED_VELLIS, ANCHOR, BACK_ROOM, MARKET, THORNWOOD]
    expect(outline(buildLocationMap(world, 'loc_anchor'))).toEqual([
      'Eldra',
      '  Harbor Market',
      '  The Rusty Anchor',
      '    the back room',
      'Thornwood',
    ])
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

describe('locationMapView.anchorOf', () => {
  it('anchors a listed place at its nearest listed ancestor, passing no left-out place', () => {
    expect(locationMapView(WORLD, null).anchorOf('loc_back')).toEqual({
      parentId: 'loc_anchor',
      hidden: 0,
    })
  })

  it('counts the left-out places between a place and its anchor', () => {
    const disabledAnchor: Entity = { ...ANCHOR, injectionMode: 'disabled' }
    const world = [ELDRA, DISABLED_VELLIS, disabledAnchor, BACK_ROOM, MARKET]
    const view = locationMapView(world, null)
    expect(view.anchorOf('loc_back')).toEqual({ parentId: 'loc_eldra', hidden: 2 })
    expect(view.anchorOf('loc_vellis')).toEqual({ parentId: 'loc_eldra', hidden: 0 })
  })

  it('anchors a place whose parent resolves to no row at the root, as the map shows it', () => {
    const orphan = location('loc_orphan', 'Orphan Quay', 'loc_gone')
    expect(locationMapView([orphan], null).anchorOf('loc_orphan')).toEqual({
      parentId: null,
      hidden: 0,
    })
  })

  it('anchors a listed row a loop keeps from the root at the root, as the map lists it', () => {
    const loop = [location('loc_la', 'Ashgate', 'loc_lb'), location('loc_lb', 'Bellmoor', 'loc_la')]
    expect(locationMapView(loop, null).anchorOf('loc_la')).toEqual({ parentId: null, hidden: 0 })
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

  it('names a retired ancestor, which the map lists', () => {
    expect(listedAncestorNames('loc_back', [ELDRA, RETIRED_VELLIS, ANCHOR, BACK_ROOM])).toEqual([
      'The Rusty Anchor',
      'Port Vellis',
      'Eldra',
    ])
  })

  it('skips a disabled ancestor, which stays off the map though the story is inside it', () => {
    expect(listedAncestorNames('loc_back', [ELDRA, DISABLED_VELLIS, ANCHOR, BACK_ROOM])).toEqual([
      'The Rusty Anchor',
      'Eldra',
    ])
  })

  it('names an ancestor under a disabled one the story is inside', () => {
    const disabledEldra: Entity = { ...ELDRA, injectionMode: 'disabled' }
    expect(listedAncestorNames('loc_back', [disabledEldra, VELLIS, ANCHOR, BACK_ROOM])).toEqual([
      'The Rusty Anchor',
      'Port Vellis',
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
