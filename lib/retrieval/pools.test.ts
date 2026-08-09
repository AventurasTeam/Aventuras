import { describe, expect, it } from 'vitest'

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

const floorOf = (over: Partial<Parameters<typeof buildStructuralFloor>[0]> = {}) =>
  buildStructuralFloor({
    entities: [],
    lore: [],
    threads: [],
    sceneEntityIds: [],
    currentLocationId: null,
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
    const pool = filterEntityPool(entities, { floorIds: floor.seatedIds, recentProse: '' })
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
    const pool = filterEntityPool(entities, { floorIds: floor.seatedIds, recentProse: '' })
    for (const id of floor.seatedIds) expect(ids(pool)).not.toContain(id)
  })

  it('projects loaded rows down to the declared shape, on all six seated lists', () => {
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
      ],
      lore: [loadedLore({ id: 'lo_1', injectionMode: 'always' })],
      threads: [
        loadedThread({ id: 'thr_1', status: 'active' }),
        loadedThread({ id: 'thr_2', injectionMode: 'always' }),
      ],
      sceneEntityIds: ['char_1'],
      currentLocationId: 'loc_1',
    })

    expect(
      [
        floor.sceneEntities,
        floor.alwaysEntities,
        floor.activeThreads,
        floor.alwaysThreads,
        floor.alwaysLore,
      ].map((l) => l.length),
    ).toEqual([1, 1, 1, 1, 1])

    const entityKeys = ['description', 'id', 'injectionMode', 'kind', 'name', 'status'].sort()
    const threadKeys = ['description', 'id', 'injectionMode', 'status', 'title'].sort()
    const loreKeys = ['body', 'id', 'injectionMode', 'priority', 'title'].sort()

    expect(Object.keys(floor.sceneEntities[0]).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.currentLocation ?? {}).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.alwaysEntities[0]).sort()).toEqual(entityKeys)
    expect(Object.keys(floor.activeThreads[0]).sort()).toEqual(threadKeys)
    expect(Object.keys(floor.alwaysThreads[0]).sort()).toEqual(threadKeys)
    expect(Object.keys(floor.alwaysLore[0]).sort()).toEqual(loreKeys)
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
    const pool = filterEntityPool([row], { floorIds: floor.seatedIds, recentProse: '' })

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
    const pool = filterEntityPool(rows, { floorIds: new Set(), recentProse: '' })
    expect(ids(pool)).toContain('a')
    expect(ids(pool)).toContain('b')
    expect(ids(pool)).not.toContain('e')
  })

  // status arrives from an unchecked positional cast, so a value outside the
  // union (an enum rename, a hand-edited row) must exclude rather than fall
  // through — admitting it injects content injection_mode was meant to gate.
  it('excludes a status outside the union rather than admitting it', () => {
    const rogue = { ...entity({ id: 'x', name: 'Rogue' }), status: 'archived' as never }
    const pool = filterEntityPool([...rows, rogue], { floorIds: new Set(), recentProse: '' })
    expect(ids(pool)).not.toContain('x')
  })

  it('excludes retired by default but admits retired + always', () => {
    const pool = filterEntityPool(rows, { floorIds: new Set(), recentProse: '' })
    expect(ids(pool)).not.toContain('c')
    expect(ids(pool)).toContain('d')
  })

  it('excludes rows the structural floor already seated', () => {
    const pool = filterEntityPool(rows, { floorIds: new Set(['a', 'd']), recentProse: '' })
    expect(ids(pool)).toEqual(['b'])
  })

  it('suppresses a staged entity whose name appears in recent buffer prose', () => {
    const pool = filterEntityPool(rows, {
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
      ids(filterEntityPool([flagged], { floorIds: floor.seatedIds, recentProse: named })),
    ).toEqual([])

    // Same row, same prose, without the flag: suppressed and unseated.
    const ordinary = entity({ id: 'mira', status: 'staged', name: 'Mira' })
    const plainFloor = floorOf({ entities: [ordinary] })
    expect(ids(plainFloor.alwaysEntities)).toEqual([])
    expect(
      ids(filterEntityPool([ordinary], { floorIds: plainFloor.seatedIds, recentProse: named })),
    ).toEqual([])
  })

  it('does not suppress an ACTIVE entity that shares a suppressed staged name', () => {
    const namesakes = [
      entity({ id: 'active_mira', name: 'Mira' }),
      entity({ id: 'staged_mira', status: 'staged', name: 'Mira' }),
    ]
    const pool = filterEntityPool(namesakes, {
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
      floorIds: new Set(),
      recentProse: `${nfc} crossed the yard.`,
    })
    expect(ids(pool)).toEqual([])
  })

  it('suppresses a staged name prose wrote in a different case', () => {
    const pool = filterEntityPool([entity({ id: 'zoe', status: 'staged', name: 'Zoe' })], {
      floorIds: new Set(),
      recentProse: 'ZOE crossed the yard.',
    })
    expect(ids(pool)).toEqual([])
  })

  it('suppresses a staged name stored with surrounding whitespace', () => {
    const pool = filterEntityPool([entity({ id: 'padded', status: 'staged', name: '  Mira  ' })], {
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
      floorIds: floor.seatedIds,
      recentProse: 'Mira stepped out of the rain.',
    })
    expect(ids(floor.alwaysEntities)).toEqual(['m'])
    expect(ids(pool)).toEqual([])
  })

  it('does not suppress on a substring hit inside a longer word', () => {
    const pool = filterEntityPool(rows, {
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
    const pool = filterEntityPool(blank, { floorIds: new Set(), recentProse: 'Quiet street.' })
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
