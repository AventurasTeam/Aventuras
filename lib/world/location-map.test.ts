import { describe, expect, it } from 'vitest'

import { emptyEntityState, type CharacterState, type Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  buildLocationMap,
  listedAncestorNames,
  locationMapView,
  placeTree,
  realPlacementOf,
  unhiddenLocationView,
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
// data-model.md → LocationState shape: known to exist, not where.
const unplaced = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity({
    id,
    kind: 'location',
    name,
    state: { parent_location_id: null, unplaced: true },
    ...overrides,
  })
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
    expect(buildLocationMap([ELDRA, retired], null)[1]).toMatchObject({
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

  it('lists only locations', () => {
    const entities = [
      THORNWOOD,
      makeEntity({ id: 'char_aldra', kind: 'character', name: 'Aldra' }),
      item('item_anvil', 'Anvil', null),
    ]
    expect(outline(buildLocationMap(entities, null))).toEqual(['Thornwood'])
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

describe('placeTree', () => {
  const tree = (entities: readonly Entity[]) =>
    placeTree(entities).tree.map(({ entity, depth }) => `${'  '.repeat(depth)}${entity.id}`)

  it('nests every place by its real parent, children by name, whatever the input order', () => {
    expect(tree(WORLD)).toEqual([
      'loc_eldra',
      '  loc_vellis',
      '    loc_market',
      '    loc_anchor',
      '      loc_back',
      'loc_thorn',
    ])
  })

  it('hides nothing: a retired, staged or disabled place keeps its row and its children', () => {
    const world = [
      ELDRA,
      { ...VELLIS, status: 'retired' as const },
      { ...ANCHOR, status: 'staged' as const },
      { ...MARKET, injectionMode: 'disabled' as const },
      BACK_ROOM,
    ]
    expect(tree(world)).toEqual([
      'loc_eldra',
      '  loc_vellis',
      '    loc_market',
      '    loc_anchor',
      '      loc_back',
    ])
  })

  it('lists a looping chain flat at the root, after the reachable tree', () => {
    const a = location('loc_a', 'Upper', 'loc_b')
    const b = location('loc_b', 'Lower', 'loc_a')
    expect(tree([ELDRA, a, b, holder({})])).toEqual(['loc_eldra', 'loc_b', 'loc_a'])
  })
})

describe('unhiddenLocationView', () => {
  it('hangs a place only under its real parent, the root counting as one', () => {
    const view = unhiddenLocationView([ELDRA, DISABLED_VELLIS, ANCHOR, holder({})])
    expect(view.locations.map((e) => e.id)).not.toContain('char_kael')
    expect(view.hiddenBetween('loc_vellis', 'loc_eldra')).toBe(0)
    expect(view.hiddenBetween('loc_anchor', 'loc_eldra')).toBeNull()
    expect(view.hiddenBetween('loc_eldra', null)).toBe(0)
    expect(view.hiddenBetween('loc_vellis', null)).toBeNull()
  })
})

describe('locationMapView.anchorOf', () => {
  it('anchors a listed place at its nearest listed ancestor, passing no left-out place', () => {
    expect(locationMapView(WORLD, null).anchorOf('loc_back')).toEqual({
      parentId: 'loc_anchor',
      hidden: 0,
      unplaced: false,
    })
  })

  it('counts the left-out places between a place and its anchor', () => {
    const disabledAnchor: Entity = { ...ANCHOR, injectionMode: 'disabled' }
    const world = [ELDRA, DISABLED_VELLIS, disabledAnchor, BACK_ROOM, MARKET]
    const view = locationMapView(world, null)
    expect(view.anchorOf('loc_back')).toEqual({ parentId: 'loc_eldra', hidden: 2, unplaced: false })
    expect(view.anchorOf('loc_vellis')).toEqual({
      parentId: 'loc_eldra',
      hidden: 0,
      unplaced: false,
    })
  })

  it('anchors a top-level place at the root', () => {
    expect(locationMapView(WORLD, null).anchorOf('loc_eldra')).toEqual({
      parentId: null,
      hidden: 0,
      unplaced: false,
    })
  })

  it('anchors a listed row a loop keeps from the root at the root, as the map lists it', () => {
    const loop = [location('loc_la', 'Ashgate', 'loc_lb'), location('loc_lb', 'Bellmoor', 'loc_la')]
    expect(locationMapView(loop, null).anchorOf('loc_la')).toEqual({
      parentId: null,
      hidden: 0,
      unplaced: false,
    })
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

// data-model.md → LocationState shape: a place known to exist but not where, on every list of places.
describe('realPlacementOf', () => {
  const VARN = unplaced('loc_varn', 'Varn')
  const ORPHAN = location('loc_orphan', 'Orphan Quay', 'loc_gone')
  const placementAt = realPlacementOf([ELDRA, VELLIS, VARN, ORPHAN])

  it('reads the flag as unplaced, a parent that is a place as under it, none as top-level', () => {
    expect(placementAt('loc_varn')).toEqual({ kind: 'unplaced' })
    expect(placementAt('loc_vellis')).toEqual({ kind: 'under', parentId: 'loc_eldra' })
    expect(placementAt('loc_eldra')).toEqual({ kind: 'top' })
  })

  it('reads a stored parent naming no place as unplaced: its container is gone', () => {
    expect(placementAt('loc_orphan')).toEqual({ kind: 'unplaced' })
  })

  it('reads an id naming no place as top-level', () => {
    expect(placementAt('loc_none')).toEqual({ kind: 'top' })
  })
})

describe('the unplaced group', () => {
  const VARN = unplaced('loc_varn', 'Varn')
  const DOCKS = location('loc_docks', 'Varn Docks', 'loc_varn')
  const ASHFALL = unplaced('loc_ash', 'Ashfall')
  const ORPHAN = location('loc_orphan', 'Orphan Quay', 'loc_gone')

  describe('on the narrator map', () => {
    it('lists an unplaced place and what hangs under it in its own group, never in the tree', () => {
      const view = locationMapView([...WORLD, DOCKS, VARN, ASHFALL], null)
      expect(view.rows.map((r) => r.id)).not.toContain('loc_varn')
      expect(view.rows.map((r) => r.id)).not.toContain('loc_docks')
      expect(view.unplacedRows).toEqual([
        listed('loc_ash', 'Ashfall', 0),
        listed('loc_varn', 'Varn', 0),
        listed('loc_docks', 'Varn Docks', 1),
      ])
    })

    it('groups a place whose stored parent names no place with the unplaced', () => {
      const view = locationMapView([ELDRA, ORPHAN], null)
      expect(outline(view.rows)).toEqual(['Eldra'])
      expect(outline(view.unplacedRows)).toEqual(['Orphan Quay'])
    })

    it('lists a retired unplaced place by name and reason, without an id', () => {
      const retired = unplaced('loc_salt', 'Saltmere', {
        status: 'retired',
        retiredReason: 'swallowed by the rift',
      })
      expect(locationMapView([ELDRA, retired], null).unplacedRows).toEqual([
        {
          retired: true,
          id: null,
          name: 'Saltmere',
          depth: 0,
          retiredReason: 'swallowed by the rift',
        },
      ])
    })

    it('leaves out a disabled unplaced place with every place inside it', () => {
      const view = locationMapView([ELDRA, { ...VARN, injectionMode: 'disabled' }, DOCKS], null)
      expect(view.unplacedRows).toEqual([])
      expect(outline(view.rows)).toEqual(['Eldra'])
    })

    // The story is inside a disabled unplaced place: the place stays left out, its insides don't.
    it('hangs a place under a left-out unplaced one at the root of the group', () => {
      const view = locationMapView(
        [ELDRA, { ...VARN, injectionMode: 'disabled' }, DOCKS],
        'loc_docks',
      )
      expect(view.unplacedRows).toEqual([listed('loc_docks', 'Varn Docks', 0)])
      expect(view.anchorOf('loc_docks')).toEqual({ parentId: null, hidden: 1, unplaced: true })
      expect(view.hiddenBetween('loc_docks', null)).toBeNull()
      expect(view.hiddenBetween('loc_docks', 'loc_varn')).toBe(0)
    })

    it('anchors an unplaced place at the root of the group, and hangs it at no root', () => {
      const view = locationMapView([...WORLD, VARN, DOCKS], null)
      expect(view.anchorOf('loc_varn')).toEqual({ parentId: null, hidden: 0, unplaced: true })
      expect(view.hiddenBetween('loc_varn', null)).toBeNull()
      expect(view.anchorOf('loc_docks')).toEqual({
        parentId: 'loc_varn',
        hidden: 0,
        unplaced: false,
      })
      expect(view.hiddenBetween('loc_docks', 'loc_varn')).toBe(0)
      expect(view.hiddenBetween('loc_eldra', null)).toBe(0)
    })

    it('hangs a place whose stored parent names no place at no root', () => {
      expect(locationMapView([ORPHAN], null).hiddenBetween('loc_orphan', null)).toBeNull()
    })
  })

  describe('in the pass tree', () => {
    const groups = (entities: readonly Entity[]) => {
      const { tree, unplaced: group } = placeTree(entities)
      const ids = (rows: typeof tree) =>
        rows.map(({ entity, depth }) => `${'  '.repeat(depth)}${entity.id}`)
      return { tree: ids(tree), unplaced: ids(group) }
    }

    it('lists the unplaced places, each with what lies inside it, apart from the tree', () => {
      expect(groups([ELDRA, VELLIS, DOCKS, VARN, ASHFALL, ORPHAN])).toEqual({
        tree: ['loc_eldra', '  loc_vellis'],
        unplaced: ['loc_ash', 'loc_orphan', 'loc_varn', '  loc_docks'],
      })
    })

    it('hides nothing in the group either: a retired or disabled unplaced place keeps its row', () => {
      expect(
        groups([
          { ...VARN, status: 'retired' as const },
          DOCKS,
          { ...ASHFALL, injectionMode: 'disabled' as const },
        ]).unplaced,
      ).toEqual(['loc_ash', 'loc_varn', '  loc_docks'])
    })
  })

  describe('in the unhidden view', () => {
    it('hangs an unplaced place, or one whose parent is no place, at no root', () => {
      const view = unhiddenLocationView([ELDRA, VARN, DOCKS, ORPHAN])
      expect(view.hiddenBetween('loc_varn', null)).toBeNull()
      expect(view.hiddenBetween('loc_orphan', null)).toBeNull()
      expect(view.hiddenBetween('loc_docks', 'loc_varn')).toBe(0)
      expect(view.hiddenBetween('loc_eldra', null)).toBe(0)
    })
  })

  // data-model.md → LocationState shape: an unplaced current location shows just its name.
  it('gives an unplaced current location no chain, and its insides a chain that stops at it', () => {
    expect(listedAncestorNames('loc_varn', [ELDRA, VARN, DOCKS])).toEqual([])
    expect(listedAncestorNames('loc_docks', [ELDRA, VARN, DOCKS])).toEqual(['Varn'])
  })
})
