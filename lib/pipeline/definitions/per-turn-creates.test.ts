import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmbedDescriptions } from '@/lib/classifier'
import { emptyEntityState, type Entity } from '@/lib/db'
import { logger, type Logger } from '@/lib/diagnostics'
import {
  normalizeCreates,
  type NewLocationReport,
  type ParsedStateBlock,
  type SubstitutedStateBlock,
} from '@/lib/piggyback'

import { planTurnCreates, skipTurnCreates, type TurnCreatePlan } from './per-turn-creates'

const BRANCH = 'b1'
const HERO = 'char_00000000-0000-4000-8000-000000000001'
const MIRA = 'char_00000000-0000-4000-8000-000000000002'
const ELDRA = 'loc_00000000-0000-4000-8000-0000000000a1'
const PORT = 'loc_00000000-0000-4000-8000-0000000000a2'
const MARKET = 'loc_00000000-0000-4000-8000-0000000000a3'
const LOOP_A = 'loc_00000000-0000-4000-8000-0000000000a4'
const LOOP_B = 'loc_00000000-0000-4000-8000-0000000000a5'
const OLD_KEY = 'item_00000000-0000-4000-8000-0000000000b1'
const BLANK_KEY = 'item_00000000-0000-4000-8000-0000000000b2'
const IRON_KEY = 'item_00000000-0000-4000-8000-0000000000b3'
const VARN = 'loc_00000000-0000-4000-8000-0000000000a6'
const VARN_DOCKS = 'loc_00000000-0000-4000-8000-0000000000a7'
const ASH = 'loc_00000000-0000-4000-8000-0000000000a8'
const BIRCH = 'loc_00000000-0000-4000-8000-0000000000a9'
const DROWNED = 'loc_00000000-0000-4000-8000-0000000000aa'
// data-model.md → LocationState shape: known to exist, not where.
const UNPLACED = { parent_location_id: null, unplaced: true }

function row(over: Pick<Entity, 'id' | 'kind' | 'name'> & Partial<Entity>): Entity {
  return {
    branchId: BRANCH,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: emptyEntityState(over.kind),
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function world(...extra: Entity[]): Entity[] {
  return [
    row({ id: HERO, kind: 'character', name: 'Aria' }),
    row({ id: ELDRA, kind: 'location', name: 'Eldra' }),
    row({ id: PORT, kind: 'location', name: 'Port Vellis', state: { parent_location_id: ELDRA } }),
    ...extra,
  ]
}

const market = (status: Entity['status']): Entity =>
  row({
    id: MARKET,
    kind: 'location',
    name: 'The Drowned Market',
    status,
    state: { parent_location_id: PORT },
  })

const unplacedPlace = (id: string, name: string, over: Partial<Entity> = {}): Entity =>
  row({ id, kind: 'location', name, state: { parent_location_id: null, unplaced: true }, ...over })

const oldKey = (): Entity =>
  row({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'an iron key' })

const noEmbed: EmbedDescriptions = async () => ({ vectors: [], dim: 0 })

// Cast, not substituted: these blocks are built already holding ids and normalized creates.
const assumeSubstituted = (block: ParsedStateBlock) => block as SubstitutedStateBlock

const dropFlag = (r: NewLocationReport) => ('parentDropped' in r ? r.parentDropped : undefined)

function runPlanner(
  block: ParsedStateBlock,
  opts: {
    entities?: readonly Entity[]
    embed?: EmbedDescriptions
    source?: 'piggyback_tagged_block' | 'per_turn_classifier'
    mapCurrentLocationId?: string | null
    log?: Logger
  } = {},
) {
  // Deterministic per-prefix ids, so a case can name the rows it expects.
  const counts = { loc: 0, item: 0 }
  return planTurnCreates({
    block: assumeSubstituted(block),
    entities: opts.entities ?? world(),
    mapCurrentLocationId: opts.mapCurrentLocationId ?? null,
    branchId: BRANCH,
    source: opts.source ?? 'piggyback_tagged_block',
    embed: opts.embed ?? noEmbed,
    now: () => 1000,
    newId: (prefix) => `${prefix}_new_${++counts[prefix]}`,
    log: opts.log ?? logger,
  })
}

const createdEntries = (creates: TurnCreatePlan['creates']) =>
  creates.map((action) => action.payload.entry)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('planTurnCreates — kept only if used', () => {
  it('passes a block with no creates through untouched', async () => {
    const block: ParsedStateBlock = {
      sceneEntities: [HERO],
      currentLocation: PORT,
      worldTimeDelta: 5,
    }
    const plan = await runPlanner(block)
    expect(plan.block).toEqual(block)
    expect(plan.creates).toEqual([])
    expect(plan.createdRows).toEqual([])
    expect(plan.reusedIds).toEqual([])
    expect(plan.placements).toEqual([])
    expect(plan.report).toEqual({ newLocations: [], newItems: [] })
  })

  it('creates the new place named as the current location, under its parent', async () => {
    const plan = await runPlanner({
      sceneEntities: [HERO],
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: PORT,
        },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        id: 'loc_new_1',
        kind: 'location',
        name: 'Smuggler Docks',
        description: 'a rotting pier',
        state: { parent_location_id: PORT },
        nameCollisionFlag: 0,
      }),
    ])
    expect(plan.block).toEqual({ sceneEntities: [HERO], currentLocation: 'loc_new_1' })
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:docks',
        name: 'Smuggler Docks',
        description: 'a rotting pier',
        parent: PORT,
        outcome: 'created',
        id: 'loc_new_1',
      },
    ])
  })

  it('leaves a new place with no parent unplaced, reporting none', async () => {
    const plan = await runPlanner({
      newLocations: [{ handle: 'new:isle', name: 'Gull Isle', description: 'a bare rock' }],
      currentLocation: 'new:isle',
    })
    expect(createdEntries(plan.creates)[0]?.state).toEqual(UNPLACED)
    expect(plan.placements).toEqual([])
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:isle',
        name: 'Gull Isle',
        description: 'a bare rock',
        outcome: 'created',
        id: 'loc_new_1',
      },
    ])
  })

  it("puts a new place whose parent is top at the top level, reporting 'top'", async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:isle', name: 'Gull Isle', description: 'a bare rock', parent: 'top' },
      ],
      currentLocation: 'new:isle',
    })
    expect(createdEntries(plan.creates)[0]?.state).toEqual({ parent_location_id: null })
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:isle',
        name: 'Gull Isle',
        description: 'a bare rock',
        parent: 'top',
        outcome: 'created',
        id: 'loc_new_1',
      },
    ])
    expect(warnSpy).not.toHaveBeenCalledWith('classifier.create_parent_dropped', expect.anything())
  })

  it('keeps the places the current location is part of and drops the rest where they stand', async () => {
    const debugSpy = vi.spyOn(logger, 'debug')
    const plan = await runPlanner({
      sceneEntities: [HERO, 'new:shrine'],
      newLocations: [
        { handle: 'new:town', name: 'Saltmere', description: 'a fishing town', parent: ELDRA },
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: 'new:town',
        },
        {
          handle: 'new:shrine',
          name: 'Sea Shrine',
          description: 'a drowned altar',
          parent: 'new:town',
        },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates).map((e) => e.name)).toEqual(['Saltmere', 'Smuggler Docks'])
    expect(plan.block.sceneEntities).toEqual([HERO])
    expect(plan.block.currentLocation).toBe('loc_new_2')
    expect(plan.report.newLocations[2]).toEqual({
      handle: 'new:shrine',
      name: 'Sea Shrine',
      description: 'a drowned altar',
      parent: 'new:town',
      outcome: 'dropped',
    })
    expect(debugSpy).toHaveBeenCalledWith('classifier.create_dropped', {
      kind: 'location',
      handle: 'new:shrine',
      name: 'Sea Shrine',
    })
  })

  it('keeps a new item only when a transfer gives it to a character', async () => {
    const debugSpy = vi.spyOn(logger, 'debug')
    const plan = await runPlanner({
      newItems: [
        { handle: 'new:key', name: 'rusted key', description: 'an iron key' },
        { handle: 'new:map', name: 'sea chart', description: 'a salt-stained chart' },
        { handle: 'new:coin', name: 'odd coin', description: 'a coin from nowhere' },
      ],
      transfers: {
        items: [
          { id: 'new:key', to: HERO, slot: 'inventory' },
          { id: 'new:map', to: PORT, slot: 'inventory' },
        ],
        stackables: [],
      },
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        id: 'item_new_1',
        kind: 'item',
        name: 'rusted key',
        state: { at_location_id: null },
      }),
    ])
    expect(plan.block.transfers).toEqual({
      items: [{ id: 'item_new_1', to: HERO, slot: 'inventory' }],
      stackables: [],
    })
    expect(plan.report.newItems).toEqual([
      {
        handle: 'new:key',
        name: 'rusted key',
        description: 'an iron key',
        outcome: 'created',
        id: 'item_new_1',
      },
      {
        handle: 'new:map',
        name: 'sea chart',
        description: 'a salt-stained chart',
        outcome: 'dropped',
      },
      {
        handle: 'new:coin',
        name: 'odd coin',
        description: 'a coin from nowhere',
        outcome: 'dropped',
      },
    ])
    expect(debugSpy).toHaveBeenCalledWith('classifier.create_dropped', {
      kind: 'item',
      handle: 'new:map',
      name: 'sea chart',
    })
  })

  it('drops a new item taken and then put down in the same block', async () => {
    const plan = await runPlanner({
      newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
      transfers: {
        items: [
          { id: 'new:key', to: HERO, slot: 'inventory' },
          { id: 'new:key', from: HERO, slot: 'inventory' },
        ],
        stackables: [],
      },
    })
    expect(plan.creates).toEqual([])
    expect(plan.block.transfers).toEqual({ items: [], stackables: [] })
    expect(plan.report.newItems[0]?.outcome).toBe('dropped')
  })

  it('keeps a new item taken and then given to another character', async () => {
    const plan = await runPlanner(
      {
        newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        transfers: {
          items: [
            { id: 'new:key', to: HERO, slot: 'inventory' },
            { id: 'new:key', from: HERO, to: MIRA, slot: 'inventory' },
          ],
          stackables: [],
        },
      },
      { entities: world(row({ id: MIRA, kind: 'character', name: 'Mira' })) },
    )
    expect(createdEntries(plan.creates).map((e) => e.id)).toEqual(['item_new_1'])
    expect(plan.block.transfers?.items.map((t) => [t.id, t.to])).toEqual([
      ['item_new_1', HERO],
      ['item_new_1', MIRA],
    ])
  })

  it('drops a new item a transfer only takes from someone', async () => {
    const plan = await runPlanner({
      newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
      transfers: { items: [{ id: 'new:key', from: HERO, slot: 'inventory' }], stackables: [] },
    })
    expect(plan.creates).toEqual([])
    expect(plan.block.transfers).toEqual({ items: [], stackables: [] })
    expect(plan.report.newItems[0]?.outcome).toBe('dropped')
  })

  it('never carries a place handle in a transfer, even for a kept place', async () => {
    const plan = await runPlanner({
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: PORT,
        },
      ],
      currentLocation: 'new:docks',
      transfers: { items: [{ id: 'new:docks', to: HERO, slot: 'inventory' }], stackables: [] },
    })
    expect(createdEntries(plan.creates).map((e) => e.id)).toEqual(['loc_new_1'])
    expect(plan.block.transfers).toEqual({ items: [], stackables: [] })
  })
})

describe('planTurnCreates — parents', () => {
  it("nests a child listed before its parent under the parent's new row", async () => {
    const plan = await runPlanner({
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: 'new:town',
        },
        { handle: 'new:town', name: 'Saltmere', description: 'a fishing town', parent: ELDRA },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', { parent_location_id: ELDRA }],
      ['loc_new_2', { parent_location_id: 'loc_new_1' }],
    ])
    expect(
      plan.report.newLocations.map((r) => [r.handle, r.parent, 'id' in r ? r.id : undefined]),
    ).toEqual([
      ['new:docks', 'loc_new_1', 'loc_new_2'],
      ['new:town', ELDRA, 'loc_new_1'],
    ])
  })

  it.each([
    ['a character', HERO],
    ['an undeclared handle', 'new:ghost'],
    ['an id the prompt never showed', 'l99'],
  ])('drops a parent that is %s, leaving the place unplaced, logged', async (_case, parent) => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:docks', name: 'Smuggler Docks', description: 'a pier', parent },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates)[0]?.state).toEqual(UNPLACED)
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:docks',
        name: 'Smuggler Docks',
        description: 'a pier',
        parent,
        outcome: 'created',
        id: 'loc_new_1',
        parentDropped: true,
      },
    ])
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:docks',
      parent,
      cause: 'unresolved',
    })
  })

  it('leaves both sides of a handle cycle unplaced', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:upper', name: 'Upper Hall', description: 'a gallery', parent: 'new:lower' },
        { handle: 'new:lower', name: 'Lower Hall', description: 'a cellar', parent: 'new:upper' },
      ],
      currentLocation: 'new:upper',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', UNPLACED],
      ['loc_new_2', UNPLACED],
    ])
    expect(plan.report.newLocations.map((r) => [r.parent, dropFlag(r)])).toEqual([
      ['new:lower', true],
      ['new:upper', true],
    ])
    expect(plan.block.currentLocation).toBe('loc_new_1')
  })

  // A broken cycle check spins the synchronous settle loop forever; budgeting the parent read
  // turns that hang into a failure.
  it('leaves a place that names itself as parent unplaced', async () => {
    let reads = 0
    const hall = {
      handle: 'new:hall',
      name: 'Hall of Mirrors',
      description: 'glass on every wall',
      get parent() {
        reads += 1
        if (reads > 1000) throw new Error('settling never ended')
        return 'new:hall'
      },
    }
    const plan = await runPlanner({ newLocations: [hall], currentLocation: 'new:hall' })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', UNPLACED],
    ])
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:hall',
        name: 'Hall of Mirrors',
        description: 'glass on every wall',
        parent: 'new:hall',
        outcome: 'created',
        id: 'loc_new_1',
        parentDropped: true,
      },
    ])
    expect(plan.block.currentLocation).toBe('loc_new_1')
  })

  // piggyback.md → Parent.
  it('hangs a child under a new place whose own parent was dropped', async () => {
    const plan = await runPlanner({
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: 'new:town',
        },
        { handle: 'new:town', name: 'Saltmere', description: 'a fishing town', parent: 'l99' },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates).map((e) => [e.name, e.state])).toEqual([
      ['Saltmere', UNPLACED],
      ['Smuggler Docks', { parent_location_id: 'loc_new_1' }],
    ])
    expect(plan.report.newLocations.map((r) => [r.handle, r.parent, dropFlag(r)])).toEqual([
      ['new:docks', 'loc_new_1', undefined],
      ['new:town', 'l99', true],
    ])
  })

  it('hangs a place under a cycle member once the cycle is left unplaced', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:cellar', name: 'Cellar', description: 'damp', parent: 'new:upper' },
        { handle: 'new:upper', name: 'Upper Hall', description: 'a gallery', parent: 'new:lower' },
        { handle: 'new:lower', name: 'Lower Hall', description: 'a crypt', parent: 'new:upper' },
      ],
      currentLocation: 'new:cellar',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.name, e.state])).toEqual([
      ['loc_new_1', 'Upper Hall', UNPLACED],
      ['loc_new_2', 'Lower Hall', UNPLACED],
      ['loc_new_3', 'Cellar', { parent_location_id: 'loc_new_1' }],
    ])
    expect(plan.report.newLocations.map(dropFlag)).toEqual([undefined, true, true])
  })

  it("creates the place unplaced when the parent's stored chain loops", async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner(
      {
        newLocations: [
          { handle: 'new:cellar', name: 'Cellar', description: 'damp', parent: LOOP_A },
        ],
        currentLocation: 'new:cellar',
      },
      {
        entities: world(
          row({
            id: LOOP_A,
            kind: 'location',
            name: 'Loop A',
            state: { parent_location_id: LOOP_B },
          }),
          row({
            id: LOOP_B,
            kind: 'location',
            name: 'Loop B',
            state: { parent_location_id: LOOP_A },
          }),
        ),
      },
    )
    expect(createdEntries(plan.creates)[0]?.state).toEqual(UNPLACED)
    expect(plan.report.newLocations[0]).toMatchObject({ parent: LOOP_A, parentDropped: true })
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:cellar',
      parent: LOOP_A,
      cause: 'chain-broken',
    })
  })
})

describe('planTurnCreates — a retired parent', () => {
  // piggyback.md → Creating a place or an item: a place pinned `always` can put a retired place in
  // the prompt with its id, and nothing active may sit inside a retired place.
  it('creates a place under a retired parent unplaced, logged', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const retiredPort = row({
      id: PORT,
      kind: 'location',
      name: 'Port Vellis',
      status: 'retired',
      state: { parent_location_id: ELDRA },
    })
    const plan = await runPlanner(
      {
        newLocations: [
          { handle: 'new:docks', name: 'Smuggler Docks', description: 'a pier', parent: PORT },
        ],
        currentLocation: 'new:docks',
      },
      { entities: [row({ id: ELDRA, kind: 'location', name: 'Eldra' }), retiredPort] },
    )
    expect(createdEntries(plan.creates)[0]?.state).toEqual(UNPLACED)
    expect(plan.report.newLocations[0]).toMatchObject({ parent: PORT, parentDropped: true })
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:docks',
      parent: PORT,
      cause: 'retired',
    })
  })
})

// data-model.md → LocationState shape: matching takes in unplaced places, and a reuse places one.
describe('planTurnCreates — unplaced places', () => {
  const varnCreate = (parent?: string): ParsedStateBlock => ({
    newLocations: [
      {
        handle: 'new:varn',
        name: 'varn',
        description: 'a salt town',
        ...(parent !== undefined ? { parent } : {}),
      },
    ],
    currentLocation: 'new:varn',
  })
  const placeVarn = (
    placement: { kind: 'under'; parentId: string } | { kind: 'top' },
    source: 'piggyback_tagged_block' | 'per_turn_classifier' = 'piggyback_tagged_block',
  ) => ({
    kind: 'placeLocation',
    source,
    payload: { branchId: BRANCH, id: VARN, placement, proseEntryId: null },
  })

  it.each(['piggyback_tagged_block', 'per_turn_classifier'] as const)(
    'reuses an unplaced namesake of a create under a parent and places it there (%s)',
    async (source) => {
      const plan = await runPlanner(varnCreate(ELDRA), {
        entities: world(unplacedPlace(VARN, 'Varn')),
        source,
      })
      expect(plan.creates).toEqual([])
      expect(plan.block.currentLocation).toBe(VARN)
      expect(plan.placements).toEqual([placeVarn({ kind: 'under', parentId: ELDRA }, source)])
      expect(plan.report.newLocations).toEqual([
        {
          handle: 'new:varn',
          name: 'varn',
          description: 'a salt town',
          parent: ELDRA,
          outcome: 'reused',
          id: VARN,
        },
      ])
    },
  )

  it("marks an unplaced namesake of a top-level create top-level, reporting 'top'", async () => {
    const plan = await runPlanner(varnCreate('top'), {
      entities: world(unplacedPlace(VARN, 'Varn')),
    })
    expect(plan.creates).toEqual([])
    expect(plan.placements).toEqual([placeVarn({ kind: 'top' })])
    expect(plan.report.newLocations[0]).toMatchObject({
      parent: 'top',
      outcome: 'reused',
      id: VARN,
    })
  })

  it('places a reused unplaced place under a place the same block creates', async () => {
    const plan = await runPlanner(
      {
        newLocations: [
          {
            handle: 'new:reach',
            name: 'the Eastern Reach',
            description: 'salt flats',
            parent: ELDRA,
          },
          { handle: 'new:varn', name: 'Varn', description: 'a salt town', parent: 'new:reach' },
        ],
        currentLocation: 'new:varn',
      },
      { entities: world(unplacedPlace(VARN, 'Varn')) },
    )
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', { parent_location_id: ELDRA }],
    ])
    expect(plan.placements).toEqual([placeVarn({ kind: 'under', parentId: 'loc_new_1' })])
  })

  it('collects a reused staged unplaced place for promotion as it places it', async () => {
    const plan = await runPlanner(varnCreate(ELDRA), {
      entities: world(unplacedPlace(VARN, 'Varn', { status: 'staged' })),
    })
    expect(plan.reusedIds).toEqual([VARN])
    expect(plan.placements).toHaveLength(1)
  })

  it('reuses the one exact namesake anywhere for a create with no parent, placing nothing', async () => {
    const plan = await runPlanner(
      {
        newLocations: [{ handle: 'new:market', name: 'the drowned market', description: 'mud' }],
        currentLocation: 'new:market',
      },
      { entities: world(market('active')) },
    )
    expect(plan.creates).toEqual([])
    expect(plan.placements).toEqual([])
    expect(plan.block.currentLocation).toBe(MARKET)
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:market',
        name: 'the drowned market',
        description: 'mud',
        outcome: 'reused',
        id: MARKET,
      },
    ])
  })

  it('creates a place with no parent unplaced and flagged when several places share its name', async () => {
    const plan = await runPlanner(
      {
        newLocations: [{ handle: 'new:market', name: 'The Drowned Market', description: 'mud' }],
        currentLocation: 'new:market',
      },
      {
        entities: world(
          market('active'),
          unplacedPlace(DROWNED, 'The Drowned Market', { createdAt: 2 }),
        ),
      },
    )
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        state: UNPLACED,
        nameCollisionFlag: 1,
        nameCollisionPartnerId: DROWNED,
        nameCollisionReason: 'unplaced',
      }),
    ])
  })

  it('keeps the reuse but drops its placement when the parent lies inside the reused place', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner(varnCreate(VARN_DOCKS), {
      entities: world(
        unplacedPlace(VARN, 'Varn'),
        row({
          id: VARN_DOCKS,
          kind: 'location',
          name: 'Varn Docks',
          state: { parent_location_id: VARN },
        }),
      ),
    })
    expect(plan.creates).toEqual([])
    expect(plan.placements).toEqual([])
    expect(plan.block.currentLocation).toBe(VARN)
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:varn',
        name: 'varn',
        description: 'a salt town',
        parent: VARN_DOCKS,
        outcome: 'reused',
        id: VARN,
        parentDropped: true,
      },
    ])
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:varn',
      parent: VARN_DOCKS,
      cause: 'cycle',
    })
  })

  it('drops a placement that would close a loop through one placed earlier in the block', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner(
      {
        newLocations: [
          { handle: 'new:a', name: 'Ash', description: 'a grove', parent: BIRCH },
          { handle: 'new:b', name: 'Birch', description: 'a copse', parent: 'new:a' },
        ],
        currentLocation: 'new:b',
      },
      { entities: world(unplacedPlace(ASH, 'Ash'), unplacedPlace(BIRCH, 'Birch')) },
    )
    expect(plan.placements).toEqual([
      {
        kind: 'placeLocation',
        source: 'piggyback_tagged_block',
        payload: {
          branchId: BRANCH,
          id: ASH,
          placement: { kind: 'under', parentId: BIRCH },
          proseEntryId: null,
        },
      },
    ])
    expect(plan.report.newLocations.map(dropFlag)).toEqual([undefined, true])
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:b',
      parent: ASH,
      cause: 'cycle',
    })
  })

  it('keeps a reused unplaced place unplaced when the parent the create names is retired', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const retiredPort = row({
      id: PORT,
      kind: 'location',
      name: 'Port Vellis',
      status: 'retired',
      state: { parent_location_id: ELDRA },
    })
    const plan = await runPlanner(varnCreate(PORT), {
      entities: [
        row({ id: ELDRA, kind: 'location', name: 'Eldra' }),
        retiredPort,
        unplacedPlace(VARN, 'Varn'),
      ],
    })
    expect(plan.creates).toEqual([])
    expect(plan.placements).toEqual([])
    expect(plan.report.newLocations[0]).toMatchObject({
      parent: PORT,
      outcome: 'reused',
      id: VARN,
      parentDropped: true,
    })
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:varn',
      parent: PORT,
      cause: 'retired',
    })
  })
})

describe('planTurnCreates — matching', () => {
  const marketCreate = (name: string, parent: string): ParsedStateBlock => ({
    newLocations: [{ handle: 'new:market', name, description: 'mud and awnings', parent }],
    currentLocation: 'new:market',
  })

  it('reuses an exact sibling, emitting nothing, and points the handle at it', async () => {
    const plan = await runPlanner(marketCreate('the drowned market', PORT), {
      entities: world(market('active')),
    })
    expect(plan.creates).toEqual([])
    expect(plan.block.currentLocation).toBe(MARKET)
    expect(plan.reusedIds).toEqual([])
    expect(plan.report.newLocations).toEqual([
      {
        handle: 'new:market',
        name: 'the drowned market',
        description: 'mud and awnings',
        parent: PORT,
        outcome: 'reused',
        id: MARKET,
      },
    ])
  })

  it('collects a reused staged sibling for promotion', async () => {
    const plan = await runPlanner(marketCreate('The Drowned Market', PORT), {
      entities: world(market('staged')),
    })
    expect(plan.reusedIds).toEqual([MARKET])
  })

  it('flags a partial sibling same-parent, naming it as the partner', async () => {
    const plan = await runPlanner(marketCreate('The Drowned Market Stalls', PORT), {
      entities: world(market('active')),
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        name: 'The Drowned Market Stalls',
        nameCollisionFlag: 1,
        nameCollisionPartnerId: MARKET,
        nameCollisionReason: 'same-parent',
      }),
    ])
  })

  it('flags an exact retired sibling instead of reusing it', async () => {
    const plan = await runPlanner(marketCreate('The Drowned Market', PORT), {
      entities: world(market('retired')),
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        name: 'The Drowned Market',
        nameCollisionFlag: 1,
        nameCollisionPartnerId: MARKET,
        nameCollisionReason: 'same-parent',
      }),
    ])
  })

  // piggyback.md → Matching before creating: reuse by the map the prompt showed, rebuilt around
  // the location that map was built from.
  it('reuses a place the map hid under the parent it showed', async () => {
    const disabledPort = row({
      id: PORT,
      kind: 'location',
      name: 'Port Vellis',
      injectionMode: 'disabled',
      state: { parent_location_id: ELDRA },
    })
    const entities = [
      row({ id: ELDRA, kind: 'location', name: 'Eldra' }),
      disabledPort,
      market('active'),
    ]
    const hidden = await runPlanner(marketCreate('The Drowned Market', ELDRA), { entities })
    expect(hidden.creates).toEqual([])
    expect(hidden.block.currentLocation).toBe(MARKET)
    // Around Port Vellis the map lists it, with the market under it rather than under Eldra.
    const shown = await runPlanner(marketCreate('The Drowned Market', ELDRA), {
      entities,
      mapCurrentLocationId: PORT,
    })
    expect(createdEntries(shown.creates)).toEqual([
      expect.objectContaining({ name: 'The Drowned Market', nameCollisionFlag: 0 }),
    ])
  })

  it('leaves a namesake under another parent alone', async () => {
    const plan = await runPlanner(marketCreate('The Drowned Market', ELDRA), {
      entities: world(market('active')),
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({ name: 'The Drowned Market', nameCollisionFlag: 0 }),
    ])
  })

  it('creates a new place inside a new namesake, not an alias of it', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:outer', name: 'The Keep', description: 'a squat tower', parent: ELDRA },
        {
          handle: 'new:inner',
          name: 'the keep',
          description: 'its inner ward',
          parent: 'new:outer',
        },
      ],
      currentLocation: 'new:inner',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', { parent_location_id: ELDRA }],
      ['loc_new_2', { parent_location_id: 'loc_new_1' }],
    ])
    expect(plan.block.currentLocation).toBe('loc_new_2')
  })

  it('maps a second new place with the same name and parent onto the first', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:mill', name: 'Old Mill', description: 'a mill', parent: 'new:mill2' },
        { handle: 'new:mill2', name: 'old mill', description: 'the same mill', parent: 'new:mill' },
      ],
      currentLocation: 'new:mill',
    })
    expect(createdEntries(plan.creates).map((e) => e.id)).toEqual(['loc_new_1'])
    expect(plan.report.newLocations[1]).toEqual({
      handle: 'new:mill2',
      name: 'old mill',
      description: 'the same mill',
      parent: 'new:mill',
      outcome: 'reused',
      id: 'loc_new_1',
      parentDropped: true,
    })
  })

  it("doesn't compare two new places with each other", async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:a', name: 'Hall', description: 'a hall', parent: 'new:b' },
        { handle: 'new:b', name: 'Great Hall', description: 'a bigger hall', parent: 'new:a' },
      ],
      currentLocation: 'new:a',
    })
    expect(createdEntries(plan.creates).map((e) => [e.name, e.nameCollisionFlag])).toEqual([
      ['Hall', 0],
      ['Great Hall', 0],
    ])
  })

  const keyCreate = (description: string, name = 'Rusted Key'): ParsedStateBlock => ({
    newItems: [{ handle: 'new:key', name, description }],
    transfers: { items: [{ id: 'new:key', to: HERO, slot: 'inventory' }], stackables: [] },
  })

  it('flags a new item alike its exact namesake and creates it all the same', async () => {
    const embed = vi.fn(async () => ({
      vectors: [new Float32Array([1, 0]), new Float32Array([1, 0])],
      dim: 2,
    }))
    const plan = await runPlanner(keyCreate('an iron key, flaked with rust'), {
      entities: world(oldKey()),
      embed,
    })
    expect(embed).toHaveBeenCalledOnce()
    expect(embed).toHaveBeenCalledWith(['an iron key, flaked with rust', 'an iron key'])
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        id: 'item_new_1',
        nameCollisionFlag: 1,
        nameCollisionPartnerId: OLD_KEY,
        nameCollisionReason: 'alike',
      }),
    ])
    expect(plan.report.newItems[0]).toMatchObject({ outcome: 'created', id: 'item_new_1' })
  })

  it('flags a new item ambiguous against a partly alike namesake', async () => {
    const embed = vi.fn(async () => ({
      vectors: [new Float32Array([1, 0]), new Float32Array([0.6, 0.8])],
      dim: 2,
    }))
    const plan = await runPlanner(keyCreate('a key of some kind'), {
      entities: world(oldKey()),
      embed,
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({
        nameCollisionPartnerId: OLD_KEY,
        nameCollisionReason: 'ambiguous',
      }),
    ])
  })

  it('creates an item plain, unembedded, when its description is blank', async () => {
    const embed = vi.fn(noEmbed)
    const plan = await runPlanner(keyCreate('   '), { entities: world(oldKey()), embed })
    expect(embed).not.toHaveBeenCalled()
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({ description: null, nameCollisionFlag: 0 }),
    ])
  })

  // observability.md → Record shape: the warn rides the turn's logger, so it names the turn.
  it("warns through the turn's logger when an item's embed throws, creating it unflagged", async () => {
    const warn = vi.fn()
    const plan = await runPlanner(keyCreate('an iron key, flaked with rust'), {
      entities: world(oldKey()),
      embed: async () => {
        throw new Error('embedder offline')
      },
      log: { ...logger, warn },
    })
    expect(warn).toHaveBeenCalledWith('classifier.description_embed_failed', {
      error: 'embedder offline',
    })
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({ id: 'item_new_1', nameCollisionFlag: 0 }),
    ])
  })

  it('makes no embed call for an item with no namesake', async () => {
    const embed = vi.fn(noEmbed)
    await runPlanner(keyCreate('salt-stained', 'sea chart'), { entities: world(oldKey()), embed })
    expect(embed).not.toHaveBeenCalled()
  })

  it('lines each score up with its namesake when one has no description to send', async () => {
    const embed = vi.fn(async () => ({
      vectors: [new Float32Array([1, 0]), new Float32Array([0, 1]), new Float32Array([1, 0])],
      dim: 2,
    }))
    const plan = await runPlanner(keyCreate('an iron key, flaked with rust'), {
      entities: world(
        row({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'bronze', createdAt: 1 }),
        row({ id: BLANK_KEY, kind: 'item', name: 'Rusted Key', description: null, createdAt: 2 }),
        row({ id: IRON_KEY, kind: 'item', name: 'RUSTED KEY', description: 'iron', createdAt: 3 }),
      ),
      embed,
    })
    expect(embed).toHaveBeenCalledWith(['an iron key, flaked with rust', 'bronze', 'iron'])
    expect(createdEntries(plan.creates)).toEqual([
      expect.objectContaining({ nameCollisionPartnerId: IRON_KEY, nameCollisionReason: 'alike' }),
    ])
  })

  it('embeds once per item with namesakes, against stored rows only', async () => {
    const embed = vi.fn(noEmbed)
    await runPlanner(
      {
        newItems: [
          { handle: 'new:a', name: 'rusted key', description: 'small' },
          { handle: 'new:b', name: 'sea chart', description: 'salt-stained' },
          { handle: 'new:c', name: 'rusted key', description: 'large' },
        ],
        transfers: {
          items: ['new:a', 'new:b', 'new:c'].map((id) => ({
            id,
            to: HERO,
            slot: 'inventory' as const,
          })),
          stackables: [],
        },
      },
      { entities: world(oldKey()), embed },
    )
    expect(embed.mock.calls).toEqual([[['small', 'an iron key']], [['large', 'an iron key']]])
  })

  // The turn is hard-gated, so the embeds overlap; the first resolving last checks order holds.
  it('embeds the items concurrently and still writes them in emission order', async () => {
    let inFlight = 0
    let peak = 0
    const embed: EmbedDescriptions = async (texts) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      const alike = texts[0] === 'small'
      await new Promise((resolve) => setTimeout(resolve, alike ? 20 : 0))
      inFlight -= 1
      return {
        vectors: [new Float32Array([1, 0]), new Float32Array(alike ? [1, 0] : [0, 1])],
        dim: 2,
      }
    }
    const plan = await runPlanner(
      {
        newItems: [
          { handle: 'new:a', name: 'rusted key', description: 'small' },
          { handle: 'new:b', name: 'sea chart', description: 'salt-stained' },
          { handle: 'new:c', name: 'rusted key', description: 'large' },
        ],
        transfers: {
          items: ['new:a', 'new:b', 'new:c'].map((id) => ({
            id,
            to: HERO,
            slot: 'inventory' as const,
          })),
          stackables: [],
        },
      },
      { entities: world(oldKey()), embed },
    )
    expect(peak).toBe(2)
    expect(
      createdEntries(plan.creates).map((e) => [e.id, e.description, e.nameCollisionPartnerId]),
    ).toEqual([
      ['item_new_1', 'small', OLD_KEY],
      ['item_new_2', 'salt-stained', null],
      ['item_new_3', 'large', null],
    ])
    expect(plan.report.newItems.map((r) => [r.handle, 'id' in r ? r.id : undefined])).toEqual([
      ['new:a', 'item_new_1'],
      ['new:b', 'item_new_2'],
      ['new:c', 'item_new_3'],
    ])
  })

  it('creates both of two new items with one name', async () => {
    const plan = await runPlanner({
      newItems: [
        { handle: 'new:a', name: 'brass key', description: 'small' },
        { handle: 'new:b', name: 'brass key', description: 'large' },
      ],
      transfers: {
        items: [
          { id: 'new:a', to: HERO, slot: 'inventory' },
          { id: 'new:b', to: HERO, slot: 'equipped_items' },
        ],
        stackables: [],
      },
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.nameCollisionFlag])).toEqual([
      ['item_new_1', 0],
      ['item_new_2', 0],
    ])
  })
})

describe('planTurnCreates — rows and order', () => {
  it('writes an active, auto, stale row with the clamped text, under the caller as source', async () => {
    const name = `  ${'N'.repeat(130)}  `
    const description = 'd'.repeat(1300)
    const plan = await runPlanner(
      {
        newLocations: [{ handle: 'new:hall', name, description }],
        currentLocation: 'new:hall',
      },
      { source: 'per_turn_classifier' },
    )
    expect(plan.creates.map((a) => a.source)).toEqual(['per_turn_classifier'])
    expect(createdEntries(plan.creates)).toEqual([
      {
        id: 'loc_new_1',
        branchId: BRANCH,
        kind: 'location',
        name: 'N'.repeat(120),
        description: 'd'.repeat(1200),
        status: 'active',
        retiredReason: null,
        injectionMode: 'auto',
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
        state: UNPLACED,
        tags: [],
        keywords: [],
        priority: 0,
        embeddingStale: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ])
    expect(plan.createdRows).toEqual(createdEntries(plan.creates))
    // The report keeps what the model emitted, before clamping.
    expect(plan.report.newLocations[0]).toMatchObject({ name, description })
  })

  it('emits locations before items, parents before children', async () => {
    const plan = await runPlanner({
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: 'new:town',
        },
        { handle: 'new:town', name: 'Saltmere', description: 'a fishing town', parent: ELDRA },
      ],
      currentLocation: 'new:docks',
      newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
      transfers: { items: [{ id: 'new:key', to: HERO, slot: 'inventory' }], stackables: [] },
    })
    expect(createdEntries(plan.creates).map((e) => e.id)).toEqual([
      'loc_new_1',
      'loc_new_2',
      'item_new_1',
    ])
  })
})

describe('planTurnCreates — handles', () => {
  it('names each created or reused row in the scene list', async () => {
    const plan = await runPlanner(
      {
        sceneEntities: [HERO, 'new:market', 'new:key'],
        newLocations: [
          { handle: 'new:market', name: 'The Drowned Market', description: 'mud', parent: PORT },
        ],
        currentLocation: 'new:market',
        newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        transfers: { items: [{ id: 'new:key', to: HERO, slot: 'inventory' }], stackables: [] },
      },
      { entities: world(market('active')) },
    )
    expect(plan.block).toEqual({
      sceneEntities: [HERO, MARKET, 'item_new_1'],
      currentLocation: MARKET,
      transfers: { items: [{ id: 'item_new_1', to: HERO, slot: 'inventory' }], stackables: [] },
    })
  })

  // apply.ts then rejects it as it rejects an item's id there: flag, warning, previous location.
  it("leaves an unkept new item's handle as the current location, for apply.ts to reject", async () => {
    const plan = await runPlanner({
      newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
      currentLocation: 'new:key',
    })
    expect(plan.creates).toEqual([])
    expect(plan.block).toEqual({ currentLocation: 'new:key' })
  })
})

describe('skipTurnCreates', () => {
  it('creates nothing, reports every create dropped, and drops each handle where it stands', () => {
    const plan = skipTurnCreates(
      assumeSubstituted({
        sceneEntities: [HERO, 'new:key'],
        newLocations: [
          {
            handle: 'new:docks',
            name: 'Smuggler Docks',
            description: 'a rotting pier',
            parent: PORT,
          },
        ],
        currentLocation: 'new:docks',
        newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
        transfers: {
          items: [
            { id: 'new:key', to: HERO, slot: 'inventory' },
            { id: OLD_KEY, to: HERO, slot: 'equipped_items' },
          ],
          stackables: [],
        },
        worldTimeDelta: 5,
      }),
    )
    expect(plan.block).toEqual({
      sceneEntities: [HERO],
      transfers: { items: [{ id: OLD_KEY, to: HERO, slot: 'equipped_items' }], stackables: [] },
      worldTimeDelta: 5,
    })
    expect(plan.creates).toEqual([])
    expect(plan.createdRows).toEqual([])
    expect(plan.reusedIds).toEqual([])
    expect(plan.placements).toEqual([])
    expect(plan.report).toEqual({
      newLocations: [
        {
          handle: 'new:docks',
          name: 'Smuggler Docks',
          description: 'a rotting pier',
          parent: PORT,
          outcome: 'dropped',
        },
      ],
      newItems: [
        { handle: 'new:key', name: 'rusted key', description: 'an iron key', outcome: 'dropped' },
      ],
    })
  })
})

describe('planner input', () => {
  it('takes only a substituted block', () => {
    const normalized = normalizeCreates({ sceneEntities: [HERO] }).block
    // @ts-expect-error a normalized block still holds placeholders
    const skip = () => skipTurnCreates(normalized)
    const plan = () =>
      planTurnCreates({
        // @ts-expect-error nor may it reach the planner
        block: normalized,
        entities: world(),
        mapCurrentLocationId: null,
        branchId: BRANCH,
        source: 'per_turn_classifier',
        embed: noEmbed,
        now: () => 1000,
        newId: (prefix) => prefix,
        log: logger,
      })
    expect([skip, plan].map((call) => typeof call)).toEqual(['function', 'function'])
  })
})
