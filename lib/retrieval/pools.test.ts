import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  buildStructuralFloor,
  filterEntityPool,
  filterLorePool,
  filterThreadPool,
  poolIdsFromKnn,
  type EntityRow,
  type LoreRow,
  type ThreadRow,
} from './pools'
import type { LoadedEntityRow, LoadedLoreRow, LoadedThreadRow } from './source-rows'

const entity = (over: Partial<EntityRow> & Pick<EntityRow, 'id'>): EntityRow => ({
  kind: 'character',
  status: 'active',
  injectionMode: 'auto',
  name: over.id,
  description: null,
  ...over,
})

const lore = (over: Partial<LoreRow> & Pick<LoreRow, 'id'>): LoreRow => ({
  title: over.id,
  body: null,
  injectionMode: 'auto',
  priority: 0,
  ...over,
})

const thread = (over: Partial<ThreadRow> & Pick<ThreadRow, 'id'>): ThreadRow => ({
  status: 'pending',
  injectionMode: 'auto',
  title: over.id,
  description: null,
  ...over,
})

const loadedEntity = (over: Partial<EntityRow> & Pick<EntityRow, 'id'>): LoadedEntityRow => ({
  ...entity(over),
  keywords: [],
  priority: 0,
  embeddingStale: true,
})

const loadedLore = (over: Partial<LoreRow> & Pick<LoreRow, 'id'>): LoadedLoreRow => ({
  ...lore(over),
  keywords: [],
  embeddingStale: true,
})

const loadedThread = (over: Partial<ThreadRow> & Pick<ThreadRow, 'id'>): LoadedThreadRow => ({
  ...thread(over),
  embeddingStale: true,
})

const NONE: ReadonlySet<string> = new Set()

const floorOf = (over: Partial<Parameters<typeof buildStructuralFloor>[0]> = {}) =>
  buildStructuralFloor({
    entities: [],
    storeEntities: [],
    lore: [],
    threads: [],
    sceneEntityIds: [],
    currentLocationId: null,
    disabledPlaceIds: NONE,
    ...over,
  })

const ids = <T extends { id: string }>(rows: readonly T[]): string[] => rows.map((r) => r.id)

describe('buildStructuralFloor', () => {
  const entities = [
    entity({ id: 'char_a', injectionMode: 'disabled', name: 'Aria' }),
    entity({ id: 'char_b', injectionMode: 'disabled', name: 'Off' }),
    entity({ id: 'loc_a', kind: 'location', name: 'Hollow' }),
    entity({ id: 'item_a', kind: 'item', injectionMode: 'always', name: 'Amulet' }),
  ]

  it('seats a disabled entity that is active and in scene', () => {
    const floor = floorOf({ entities, sceneEntityIds: ['char_a'] })
    expect(ids(floor.sceneEntities)).toContain('char_a')
  })

  it('does not seat or pool a disabled entity that is off-scene', () => {
    const floor = floorOf({ entities, sceneEntityIds: ['char_a'] })
    const pool = filterEntityPool(entities, {
      disabledPlaceIds: NONE,
      floorIds: floor.seatedIds,
      recentProse: '',
    })
    expect(ids(floor.sceneEntities)).not.toContain('char_b')
    expect(ids(floor.alwaysEntities)).not.toContain('char_b')
    expect(ids(pool)).not.toContain('char_b')
  })

  it('seats the current location even when it is not in sceneEntities', () => {
    const floor = floorOf({ entities, currentLocationId: 'loc_a' })
    expect(floor.currentLocation?.id).toBe('loc_a')
    expect(floor.seatedIds.has('loc_a')).toBe(true)
  })

  it('does not seat a current location that is not active', () => {
    const floor = floorOf({
      entities: [entity({ id: 'loc_a', kind: 'location', status: 'retired' })],
      currentLocationId: 'loc_a',
    })
    expect(floor.currentLocation).toBeNull()
  })

  it('leaves currentLocation null when the scene has no location', () => {
    expect(floorOf({ entities }).currentLocation).toBeNull()
  })

  // Only reachable from classifier output that violates the kind-aware scene
  // contract; canon never puts a location in sceneEntities.
  it('seats a malformed scene-listed location once, not also as a scene entity', () => {
    const floor = floorOf({
      entities,
      sceneEntityIds: ['char_a', 'loc_a'],
      currentLocationId: 'loc_a',
    })
    expect(floor.currentLocation?.id).toBe('loc_a')
    expect(ids(floor.sceneEntities)).toEqual(['char_a'])
  })

  // retrieval.md → Structural floor: the ancestor's `disabled` beats a place's own `always`.
  it('does not seat an always place disabled through an ancestor', () => {
    const room = entity({ id: 'loc_room', kind: 'location', injectionMode: 'always' })
    const floor = floorOf({ entities: [room], disabledPlaceIds: new Set(['loc_room']) })
    expect(floor.alwaysEntities).toEqual([])
    expect(floor.seatedIds.has('loc_room')).toBe(false)
  })

  it('seats injection_mode=always rows across entities, lore and threads', () => {
    const floor = floorOf({
      entities,
      lore: [lore({ id: 'lore_a', injectionMode: 'always' }), lore({ id: 'lore_b' })],
      threads: [
        thread({ id: 'thr_a', status: 'active' }),
        thread({ id: 'thr_b' }),
        thread({ id: 'thr_c', injectionMode: 'always' }),
      ],
    })
    expect(ids(floor.alwaysEntities)).toEqual(['item_a'])
    expect(ids(floor.alwaysLore)).toEqual(['lore_a'])
    expect(ids(floor.alwaysThreads)).toEqual(['thr_c'])
    expect(ids(floor.activeThreads)).toEqual(['thr_a'])
  })

  it('does not list an always row twice when the floor already seats it', () => {
    const floor = floorOf({
      entities: [
        entity({ id: 'char_a', injectionMode: 'always' }),
        entity({ id: 'loc_a', kind: 'location', injectionMode: 'always' }),
      ],
      threads: [thread({ id: 'thr_a', status: 'active', injectionMode: 'always' })],
      sceneEntityIds: ['char_a'],
      currentLocationId: 'loc_a',
    })
    expect(ids(floor.alwaysEntities)).toEqual([])
    expect(ids(floor.alwaysThreads)).toEqual([])
    expect([...floor.seatedIds].sort()).toEqual(['char_a', 'loc_a', 'thr_a'])
  })

  it('seatedIds covers every seated row and nothing else', () => {
    const floor = floorOf({
      entities,
      lore: [lore({ id: 'lore_a', injectionMode: 'always' })],
      threads: [thread({ id: 'thr_a', status: 'active' })],
      sceneEntityIds: ['char_a'],
      currentLocationId: 'loc_a',
    })
    expect([...floor.seatedIds].sort()).toEqual(['char_a', 'item_a', 'loc_a', 'lore_a', 'thr_a'])
  })

  it('never lists a row in both the floor and the ranker pool', () => {
    const floor = floorOf({ entities, sceneEntityIds: ['char_a'], currentLocationId: 'loc_a' })
    const pool = filterEntityPool(entities, {
      disabledPlaceIds: NONE,
      floorIds: floor.seatedIds,
      recentProse: '',
    })
    for (const id of floor.seatedIds) expect(ids(pool)).not.toContain(id)
  })

  it('projects loaded rows down to the declared shape, on all nine seated lists', () => {
    // Typed as Loaded*Row via the factories above, not EntityRow/LoreRow/ThreadRow:
    // annotating the fixture as the narrower type would trip excess-property
    // checking and force it narrow, proving nothing about the runtime widening.
    // One row per destination: an active+always thread seats only as active, so
    // activeThreads and alwaysThreads each need their own row to be observed.
    const floor = buildStructuralFloor({
      entities: [
        loadedEntity({ id: 'char_1' }),
        loadedEntity({ id: 'loc_1', kind: 'location' }),
        loadedEntity({ id: 'char_2', injectionMode: 'always' }),
        loadedEntity({ id: 'fact_1', kind: 'faction' }),
        loadedEntity({ id: 'item_1', kind: 'item' }),
        loadedEntity({ id: 'item_2', kind: 'item' }),
      ],
      lore: [loadedLore({ id: 'lo_1', injectionMode: 'always' })],
      threads: [
        loadedThread({ id: 'thr_1', status: 'active' }),
        loadedThread({ id: 'thr_2', injectionMode: 'always' }),
      ],
      sceneEntityIds: ['char_1'],
      currentLocationId: 'loc_1',
      disabledPlaceIds: NONE,
      storeEntities: [
        makeEntity({
          id: 'char_1',
          kind: 'character',
          name: 'char_1',
          state: { faction_id: 'fact_1', inventory: ['item_1'] } as Entity['state'],
        }),
        makeEntity({ id: 'loc_1', kind: 'location', name: 'loc_1' }),
        makeEntity({ id: 'fact_1', kind: 'faction', name: 'fact_1' }),
        makeEntity({ id: 'item_1', kind: 'item', name: 'item_1' }),
        makeEntity({
          id: 'item_2',
          kind: 'item',
          name: 'item_2',
          state: { at_location_id: 'loc_1' },
        }),
      ],
    })

    expect(
      [
        floor.sceneEntities,
        floor.sceneFactions,
        floor.heldItems,
        floor.looseItems,
        floor.alwaysEntities,
        floor.activeThreads,
        floor.alwaysThreads,
        floor.alwaysLore,
      ].map((l) => l.length),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1])

    const entityKeys = ['description', 'id', 'injectionMode', 'kind', 'name', 'status'].sort()
    const threadKeys = ['description', 'id', 'injectionMode', 'status', 'title'].sort()
    const loreKeys = ['body', 'id', 'injectionMode', 'priority', 'title'].sort()

    expect(Object.keys(floor.sceneEntities[0]).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.currentLocation ?? {}).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.alwaysEntities[0]).sort()).toEqual(entityKeys)
    for (const row of [floor.sceneFactions[0], floor.heldItems[0], floor.looseItems[0]])
      expect(Object.keys(row).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.activeThreads[0]).sort()).toEqual(threadKeys)
    expect(Object.keys(floor.alwaysThreads[0]).sort()).toEqual(threadKeys)
    expect(Object.keys(floor.alwaysLore[0]).sort()).toEqual(loreKeys)
  })
})

// One world as both the store's rows, which the views read, and retrieval's source rows.
function impliedFloor(
  rows: Entity[],
  scene: { sceneEntities: string[]; currentLocationId: string | null },
) {
  return buildStructuralFloor({
    entities: rows.map((e) => entity(e)),
    lore: [],
    threads: [],
    sceneEntityIds: scene.sceneEntities,
    currentLocationId: scene.currentLocationId,
    disabledPlaceIds: NONE,
    storeEntities: rows,
  })
}

const character = (id: string, state: object, over: Partial<Entity> = {}) =>
  makeEntity({ id, kind: 'character', name: id, state: state as Entity['state'], ...over })
const thing = (id: string, over: Partial<Entity> = {}, state: object = {}) =>
  makeEntity({ id, kind: 'item', name: id, state: { at_location_id: null, ...state }, ...over })
const faction = (id: string, over: Partial<Entity> = {}) =>
  makeEntity({ id, kind: 'faction', name: id, ...over })
const place = (id: string) => makeEntity({ id, kind: 'location', name: id })

describe('buildStructuralFloor — what the scene implies', () => {
  const SCENE = { sceneEntities: ['char_a', 'char_b'], currentLocationId: 'loc_1' }

  it("seats the in-scene characters' factions, their held items and the loose items, once each", () => {
    const rows = [
      character('char_a', { faction_id: 'fact_1', inventory: ['item_h'] }),
      character('char_b', { faction_id: 'fact_1', equipped_items: ['item_e'] }),
      faction('fact_1'),
      thing('item_h'),
      thing('item_e'),
      thing('item_l', {}, { at_location_id: 'loc_1' }),
      place('loc_1'),
    ]
    const floor = impliedFloor(rows, SCENE)
    expect(ids(floor.sceneFactions)).toEqual(['fact_1'])
    expect(ids(floor.heldItems)).toEqual(['item_h', 'item_e'])
    expect(ids(floor.looseItems)).toEqual(['item_l'])
    for (const id of ['fact_1', 'item_h', 'item_e', 'item_l']) expect(floor.seatedIds).toContain(id)
    // Seated means never ranked or keyword-injected again: both read the pool filter.
    const pool = filterEntityPool(
      rows.map((e) => entity(e)),
      {
        floorIds: floor.seatedIds,
        recentProse: '',
        disabledPlaceIds: NONE,
      },
    )
    expect(ids(pool)).toEqual([])
  })

  it('seats an `always` held item and faction once, as what the scene implies', () => {
    const rows = [
      character('char_a', { faction_id: 'fact_1', inventory: ['item_h'] }),
      faction('fact_1', { injectionMode: 'always' }),
      thing('item_h', { injectionMode: 'always' }),
    ]
    const floor = impliedFloor(rows, SCENE)
    expect(ids(floor.sceneFactions)).toEqual(['fact_1'])
    expect(ids(floor.heldItems)).toEqual(['item_h'])
    expect(ids(floor.alwaysEntities)).toEqual([])
  })

  it('seats nothing retired or disabled, nor what an off-scene or staged character holds', () => {
    const rows = [
      character('char_a', { faction_id: 'fact_r', inventory: ['item_r', 'item_d'] }),
      character('char_b', { faction_id: 'fact_d' }),
      character('char_s', { inventory: ['item_s'] }, { status: 'staged' }),
      character('char_o', { faction_id: 'fact_o', inventory: ['item_o'] }),
      faction('fact_r', { status: 'retired' }),
      faction('fact_d', { injectionMode: 'disabled' }),
      faction('fact_o'),
      thing('item_r', { status: 'retired' }),
      thing('item_d', { injectionMode: 'disabled' }),
      thing('item_s'),
      thing('item_o'),
      thing('item_x', { injectionMode: 'disabled' }, { at_location_id: 'loc_1' }),
      place('loc_1'),
    ]
    const floor = impliedFloor(rows, { ...SCENE, sceneEntities: ['char_a', 'char_b', 'char_s'] })
    expect(ids(floor.sceneFactions)).toEqual([])
    expect(ids(floor.heldItems)).toEqual([])
    expect(ids(floor.looseItems)).toEqual([])
  })

  it('leaves a disabled held item the scene names to the scene seat, not a second one', () => {
    const rows = [
      character('char_a', { inventory: ['item_d'] }),
      thing('item_d', { injectionMode: 'disabled' }),
    ]
    const floor = impliedFloor(rows, {
      sceneEntities: ['char_a', 'item_d'],
      currentLocationId: null,
    })
    expect(ids(floor.sceneEntities)).toEqual(['char_a', 'item_d'])
    expect(ids(floor.heldItems)).toEqual([])
  })
})

describe("buildStructuralFloor — the current location's chain", () => {
  const nested = (id: string, name: string, parent: string | null, over: Partial<Entity> = {}) =>
    makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...over })
  const WORLD = [
    nested('loc_back', 'The back room', 'loc_anchor'),
    nested('loc_anchor', 'The Rusty Anchor', 'loc_docks'),
    nested('loc_docks', 'The Docks', 'loc_vellis', { injectionMode: 'disabled' }),
    nested('loc_vellis', 'Port Vellis', 'loc_eldra'),
    nested('loc_eldra', 'Eldra', null),
  ]

  it('lists the listed ancestors, nearest first, leaving out a disabled one', () => {
    const floor = impliedFloor(WORLD, { sceneEntities: [], currentLocationId: 'loc_back' })
    expect(floor.currentLocationChain).toEqual(['The Rusty Anchor', 'Port Vellis', 'Eldra'])
  })

  it.each([
    ['no location', null],
    ['an inactive one', 'loc_gone'],
  ])('is empty when the scene names %s', (_case, currentLocationId) => {
    const rows = [...WORLD, nested('loc_gone', 'The old mill', 'loc_eldra', { status: 'retired' })]
    const floor = impliedFloor(rows, { sceneEntities: [], currentLocationId })
    expect(floor.currentLocation).toBeNull()
    expect(floor.currentLocationChain).toEqual([])
  })
})

type EntityDestination = 'scene' | 'location' | 'always' | 'pool'

// Every entities row lands in exactly one place, hand-derived from
// retrieval.md → Structural floor (both seats carry `status='active'`) and
// → Three-sub-pool entity model. Keyed
// `status|injectionMode|inScene|isCurrentLocation`; [] means the row is
// dropped entirely this turn.
//
// The `|1|1` rows pin a state canon rules out — scene presence is kind-aware
// (data-model.md → Entry metadata shape), so no row is both a scene entity and
// the current location. They are kept as a defence against malformed classifier
// metadata, not as a legal configuration.
const ENTITY_PLACEMENT: Record<string, EntityDestination[]> = {
  'active|always|0|0': ['always'],
  'active|always|0|1': ['location'],
  'active|always|1|0': ['scene'],
  'active|always|1|1': ['location'],
  'active|auto|0|0': ['pool'],
  'active|auto|0|1': ['location'],
  'active|auto|1|0': ['scene'],
  'active|auto|1|1': ['location'],
  'active|disabled|0|0': [],
  'active|disabled|0|1': ['location'],
  'active|disabled|1|0': ['scene'],
  'active|disabled|1|1': ['location'],
  'staged|always|0|0': ['always'],
  'staged|always|0|1': ['always'],
  'staged|always|1|0': ['always'],
  'staged|always|1|1': ['always'],
  'staged|auto|0|0': ['pool'],
  'staged|auto|0|1': ['pool'],
  'staged|auto|1|0': ['pool'],
  'staged|auto|1|1': ['pool'],
  'staged|disabled|0|0': [],
  'staged|disabled|0|1': [],
  'staged|disabled|1|0': [],
  'staged|disabled|1|1': [],
  'retired|always|0|0': ['always'],
  'retired|always|0|1': ['always'],
  'retired|always|1|0': ['always'],
  'retired|always|1|1': ['always'],
  'retired|auto|0|0': [],
  'retired|auto|0|1': [],
  'retired|auto|1|0': [],
  'retired|auto|1|1': [],
  'retired|disabled|0|0': [],
  'retired|disabled|0|1': [],
  'retired|disabled|1|0': [],
  'retired|disabled|1|1': [],
}

describe('entity placement sweep', () => {
  it.each(Object.entries(ENTITY_PLACEMENT))('%s -> %j', (key, expected) => {
    const [status, injectionMode, inScene, isLocation] = key.split('|')
    const row = entity({
      id: 'x',
      status: status as EntityRow['status'],
      injectionMode: injectionMode as EntityRow['injectionMode'],
    })
    const floor = floorOf({
      entities: [row],
      sceneEntityIds: inScene === '1' ? ['x'] : [],
      currentLocationId: isLocation === '1' ? 'x' : null,
    })
    const pool = filterEntityPool([row], {
      disabledPlaceIds: NONE,
      floorIds: floor.seatedIds,
      recentProse: '',
    })

    const actual: EntityDestination[] = []
    if (ids(floor.sceneEntities).includes('x')) actual.push('scene')
    if (floor.currentLocation?.id === 'x') actual.push('location')
    if (ids(floor.alwaysEntities).includes('x')) actual.push('always')
    if (ids(pool).includes('x')) actual.push('pool')

    expect(actual).toEqual(expected)
  })
})

type ThreadDestination = 'active' | 'always' | 'pool'

// retrieval.md → Structural floor (active threads, always rows) and → Pool
// exclusions (pending / resolved / failed rank, subject to injection_mode).
const THREAD_PLACEMENT: Record<string, ThreadDestination[]> = {
  'active|always': ['active'],
  'active|auto': ['active'],
  'active|disabled': ['active'],
  'pending|always': ['always'],
  'pending|auto': ['pool'],
  'pending|disabled': [],
  'resolved|always': ['always'],
  'resolved|auto': ['pool'],
  'resolved|disabled': [],
  'failed|always': ['always'],
  'failed|auto': ['pool'],
  'failed|disabled': [],
}

describe('thread placement sweep', () => {
  it.each(Object.entries(THREAD_PLACEMENT))('%s -> %j', (key, expected) => {
    const [status, injectionMode] = key.split('|')
    const row = thread({
      id: 'x',
      status: status as ThreadRow['status'],
      injectionMode: injectionMode as ThreadRow['injectionMode'],
    })
    const floor = floorOf({ threads: [row] })
    const pool = filterThreadPool([row], floor.seatedIds)

    const actual: ThreadDestination[] = []
    if (ids(floor.activeThreads).includes('x')) actual.push('active')
    if (ids(floor.alwaysThreads).includes('x')) actual.push('always')
    if (ids(pool).includes('x')) actual.push('pool')

    expect(actual).toEqual(expected)
  })
})

type LoreDestination = 'always' | 'pool'

// retrieval.md → Structural floor seats the `always` rows; `disabled` is
// "never include automatically" (data-model.md → Injection modes — unified enum
// + structural invariant) and `auto` is what is left to rank. Lore has no
// status column, so injection_mode is its only placement question.
const LORE_PLACEMENT: Record<string, LoreDestination[]> = {
  always: ['always'],
  auto: ['pool'],
  disabled: [],
}

describe('lore placement sweep', () => {
  it.each(Object.entries(LORE_PLACEMENT))('%s -> %j', (injectionMode, expected) => {
    const row = lore({ id: 'x', injectionMode: injectionMode as LoreRow['injectionMode'] })
    const floor = floorOf({ lore: [row] })
    const pool = filterLorePool([row], floor.seatedIds)

    const actual: LoreDestination[] = []
    if (ids(floor.alwaysLore).includes('x')) actual.push('always')
    if (ids(pool).includes('x')) actual.push('pool')

    expect(actual).toEqual(expected)
    expect(floor.seatedIds.has('x')).toBe(expected.includes('always'))
  })
})

describe('filterEntityPool', () => {
  const rows = [
    entity({ id: 'a', name: 'Kara' }),
    entity({ id: 'b', status: 'staged', name: 'Mira' }),
    entity({ id: 'c', status: 'retired', name: 'Old' }),
    entity({ id: 'd', status: 'retired', injectionMode: 'always', name: 'Ghost' }),
    entity({ id: 'e', injectionMode: 'disabled', name: 'Hidden' }),
  ]

  it('admits active off-scene and staged, excludes disabled', () => {
    const pool = filterEntityPool(rows, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: '',
    })
    expect(ids(pool)).toContain('a')
    expect(ids(pool)).toContain('b')
    expect(ids(pool)).not.toContain('e')
  })

  // status arrives from an unchecked positional cast, so a value outside the
  // union (an enum rename, a hand-edited row) must exclude rather than fall
  // through — admitting it injects content injection_mode was meant to gate.
  it('excludes a status outside the union rather than admitting it', () => {
    const rogue = { ...entity({ id: 'x', name: 'Rogue' }), status: 'archived' as never }
    const pool = filterEntityPool([...rows, rogue], {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: '',
    })
    expect(ids(pool)).not.toContain('x')
  })

  // retrieval.md → Pool exclusions: effectively disabled locations.
  it('excludes a place disabled through an ancestor', () => {
    const room = entity({ id: 'loc_room', kind: 'location', name: 'Vault' })
    const pool = filterEntityPool([room], {
      disabledPlaceIds: new Set(['loc_room']),
      floorIds: new Set(),
      recentProse: '',
    })
    expect(pool).toEqual([])
  })

  it('excludes retired by default but admits retired + always', () => {
    const pool = filterEntityPool(rows, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: '',
    })
    expect(ids(pool)).not.toContain('c')
    expect(ids(pool)).toContain('d')
  })

  it('excludes rows the structural floor already seated', () => {
    const pool = filterEntityPool(rows, {
      disabledPlaceIds: NONE,
      floorIds: new Set(['a', 'd']),
      recentProse: '',
    })
    expect(ids(pool)).toEqual(['b'])
  })

  it('suppresses a staged entity whose name appears in recent buffer prose', () => {
    const pool = filterEntityPool(rows, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'A woman calling herself Mira stepped out of the rain.',
    })
    expect(ids(pool)).not.toContain('b')
    expect(ids(pool)).toContain('a')
  })

  // edge-cases.md → Layer A: the exemption is the point, not an accident of
  // ordering. Suppressing an `always` row keeps its id out of the prompt, which
  // stops the model naming it in <scene_entities>, which stops piggyback
  // promoting it — the suppression would sustain itself until the next
  // classifier run.
  it('exempts a staged always row from suppression, seating it instead', () => {
    const named = 'Mira stepped out of the rain.'
    const flagged = entity({ id: 'mira', status: 'staged', injectionMode: 'always', name: 'Mira' })
    const floor = floorOf({ entities: [flagged] })
    expect(ids(floor.alwaysEntities)).toEqual(['mira'])
    expect(
      ids(
        filterEntityPool([flagged], {
          disabledPlaceIds: NONE,
          floorIds: floor.seatedIds,
          recentProse: named,
        }),
      ),
    ).toEqual([])

    // Same row, same prose, without the flag: suppressed and unseated.
    const ordinary = entity({ id: 'mira', status: 'staged', name: 'Mira' })
    const plainFloor = floorOf({ entities: [ordinary] })
    expect(ids(plainFloor.alwaysEntities)).toEqual([])
    expect(
      ids(
        filterEntityPool([ordinary], {
          disabledPlaceIds: NONE,
          floorIds: plainFloor.seatedIds,
          recentProse: named,
        }),
      ),
    ).toEqual([])
  })

  it('does not suppress an ACTIVE entity that shares a suppressed staged name', () => {
    const namesakes = [
      entity({ id: 'active_mira', name: 'Mira' }),
      entity({ id: 'staged_mira', status: 'staged', name: 'Mira' }),
    ]
    const pool = filterEntityPool(namesakes, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'Mira turned away.',
    })
    expect(ids(pool)).toEqual(['active_mira'])
  })

  it('suppresses a staged name prose wrote in a different normalization form', () => {
    const nfd = 'Zoë' // 'e' + U+0308 combining diaeresis
    const nfc = 'Zoë' // precomposed
    expect(nfd).not.toBe(nfc)
    const pool = filterEntityPool([entity({ id: 'zoe', status: 'staged', name: nfd })], {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: `${nfc} crossed the yard.`,
    })
    expect(ids(pool)).toEqual([])
  })

  it('suppresses a staged name prose wrote in a different case', () => {
    const pool = filterEntityPool([entity({ id: 'zoe', status: 'staged', name: 'Zoe' })], {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'ZOE crossed the yard.',
    })
    expect(ids(pool)).toEqual([])
  })

  it('suppresses a staged name stored with surrounding whitespace', () => {
    const pool = filterEntityPool([entity({ id: 'padded', status: 'staged', name: '  Mira  ' })], {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'Mira left before dawn.',
    })
    expect(ids(pool)).toEqual([])
  })

  // Layer-A suppression is a pool rule; injection_mode='always' seats the row
  // in the floor, which never consults prose. Pinned because the two canon
  // rules genuinely collide here.
  it('does not let Layer-A suppression override injection_mode=always', () => {
    const row = entity({ id: 'm', status: 'staged', injectionMode: 'always', name: 'Mira' })
    const floor = floorOf({ entities: [row] })
    const pool = filterEntityPool([row], {
      disabledPlaceIds: NONE,
      floorIds: floor.seatedIds,
      recentProse: 'Mira stepped out of the rain.',
    })
    expect(ids(floor.alwaysEntities)).toEqual(['m'])
    expect(ids(pool)).toEqual([])
  })

  it('does not suppress on a substring hit inside a longer word', () => {
    const pool = filterEntityPool(rows, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'It was nothing short of a miracle.',
    })
    expect(ids(pool)).toContain('b')
  })

  it('ignores a whitespace-only staged name rather than suppressing everything', () => {
    const blank = [
      entity({ id: 'blank', status: 'staged', name: '   ' }),
      entity({ id: 'other', status: 'staged', name: 'Mira' }),
    ]
    const pool = filterEntityPool(blank, {
      disabledPlaceIds: NONE,
      floorIds: new Set(),
      recentProse: 'Quiet street.',
    })
    expect(ids(pool)).toEqual(['blank', 'other'])
  })
})

describe('filterThreadPool', () => {
  const rows = [
    thread({ id: 'p', status: 'pending' }),
    thread({ id: 'r', status: 'resolved' }),
    thread({ id: 'f', status: 'failed' }),
    thread({ id: 'd', status: 'pending', injectionMode: 'disabled' }),
  ]

  it('admits pending / resolved / failed subject to injection_mode', () => {
    expect(ids(filterThreadPool(rows, new Set()))).toEqual(['p', 'r', 'f'])
  })

  it('excludes an active thread even when no floor was passed', () => {
    const withActive = [...rows, thread({ id: 'act', status: 'active' })]
    expect(ids(filterThreadPool(withActive, new Set()))).toEqual(['p', 'r', 'f'])
  })

  it('excludes a status outside the union rather than admitting it', () => {
    const rogue = { ...thread({ id: 'x' }), status: 'archived' as never }
    expect(ids(filterThreadPool([...rows, rogue], new Set()))).toEqual(['p', 'r', 'f'])
  })

  it('excludes threads already seated in the structural floor', () => {
    expect(ids(filterThreadPool(rows, new Set(['p'])))).toEqual(['r', 'f'])
  })
})

describe('poolIdsFromKnn', () => {
  it('unions the per-query id sets and de-duplicates', () => {
    expect(
      poolIdsFromKnn([
        [
          ['a', 0.1],
          ['b', 0.2],
        ],
        [
          ['b', 0.3],
          ['c', 0.4],
        ],
      ]),
    ).toEqual(new Set(['a', 'b', 'c']))
  })

  // Membership, not sequence: pool assembly intersects source rows against this,
  // so KNN rank has nowhere to survive and the signature must not imply it does.
  it('carries no order for the caller to depend on', () => {
    expect(poolIdsFromKnn([[['b', 0.9]], [['a', 0.1]]])).toEqual(new Set(['b', 'a']))
    expect(poolIdsFromKnn([[['a', 0.1]], [['b', 0.9]]])).toEqual(new Set(['b', 'a']))
  })

  it('is empty when every query returned nothing', () => {
    expect(poolIdsFromKnn([[], []]).size).toBe(0)
  })

  it('is empty when no query ran at all', () => {
    expect(poolIdsFromKnn([]).size).toBe(0)
  })
})
