import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import type { EmbedDescriptions } from '@/lib/classifier'
import { emptyEntityState, type Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { ParsedStateBlock } from '@/lib/piggyback'

import { planTurnCreates, skipTurnCreates } from './per-turn-creates'

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

const oldKey = (): Entity =>
  row({ id: OLD_KEY, kind: 'item', name: 'rusted key', description: 'an iron key' })

const noEmbed: EmbedDescriptions = async () => ({ vectors: [], dim: 0 })

function runPlanner(
  block: ParsedStateBlock,
  opts: {
    entities?: readonly Entity[]
    embed?: EmbedDescriptions
    source?: 'piggyback_tagged_block' | 'per_turn_classifier'
  } = {},
) {
  // Deterministic per-prefix ids, so a case can name the rows it expects.
  const counts = { loc: 0, item: 0 }
  return planTurnCreates({
    block,
    entities: opts.entities ?? world(),
    branchId: BRANCH,
    source: opts.source ?? 'piggyback_tagged_block',
    embed: opts.embed ?? noEmbed,
    now: () => 1000,
    newId: (prefix) => `${prefix}_new_${++counts[prefix]}`,
    log: logger,
  })
}

function createActions(actions: readonly PipelineAction[]) {
  return actions.map((action) => {
    if (action.kind !== 'createEntity') throw new Error(`expected createEntity, got ${action.kind}`)
    return action
  })
}

const createdEntries = (actions: readonly PipelineAction[]) =>
  createActions(actions).map((action) => action.payload.entry)

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

  it('puts a new place with no parent at the root', async () => {
    const plan = await runPlanner({
      newLocations: [{ handle: 'new:isle', name: 'Gull Isle', description: 'a bare rock' }],
      currentLocation: 'new:isle',
    })
    expect(createdEntries(plan.creates)[0]?.state).toEqual({ parent_location_id: null })
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
    expect(plan.report.newLocations.map((r) => [r.handle, r.parent, r.id])).toEqual([
      ['new:docks', 'loc_new_1', 'loc_new_2'],
      ['new:town', ELDRA, 'loc_new_1'],
    ])
  })

  it.each([
    ['a character', HERO],
    ['an undeclared handle', 'new:ghost'],
    ['an id the prompt never showed', 'l99'],
  ])('drops a parent that is %s to the root, logged', async (_case, parent) => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:docks', name: 'Smuggler Docks', description: 'a pier', parent },
      ],
      currentLocation: 'new:docks',
    })
    expect(createdEntries(plan.creates)[0]?.state).toEqual({ parent_location_id: null })
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

  it('drops both sides of a handle cycle to the root', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:upper', name: 'Upper Hall', description: 'a gallery', parent: 'new:lower' },
        { handle: 'new:lower', name: 'Lower Hall', description: 'a cellar', parent: 'new:upper' },
      ],
      currentLocation: 'new:upper',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.state])).toEqual([
      ['loc_new_1', { parent_location_id: null }],
      ['loc_new_2', { parent_location_id: null }],
    ])
    expect(plan.report.newLocations.map((r) => [r.parent, r.parentDropped])).toEqual([
      ['new:lower', true],
      ['new:upper', true],
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
      ['Saltmere', { parent_location_id: null }],
      ['Smuggler Docks', { parent_location_id: 'loc_new_1' }],
    ])
    expect(plan.report.newLocations.map((r) => [r.handle, r.parent, r.parentDropped])).toEqual([
      ['new:docks', 'loc_new_1', undefined],
      ['new:town', 'l99', true],
    ])
  })

  it('hangs a place under a cycle member once the cycle drops to the root', async () => {
    const plan = await runPlanner({
      newLocations: [
        { handle: 'new:cellar', name: 'Cellar', description: 'damp', parent: 'new:upper' },
        { handle: 'new:upper', name: 'Upper Hall', description: 'a gallery', parent: 'new:lower' },
        { handle: 'new:lower', name: 'Lower Hall', description: 'a crypt', parent: 'new:upper' },
      ],
      currentLocation: 'new:cellar',
    })
    expect(createdEntries(plan.creates).map((e) => [e.id, e.name, e.state])).toEqual([
      ['loc_new_1', 'Upper Hall', { parent_location_id: null }],
      ['loc_new_2', 'Lower Hall', { parent_location_id: null }],
      ['loc_new_3', 'Cellar', { parent_location_id: 'loc_new_1' }],
    ])
    expect(plan.report.newLocations.map((r) => r.parentDropped)).toEqual([undefined, true, true])
  })

  it("creates at the root when the parent's stored chain loops", async () => {
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
    expect(createdEntries(plan.creates)[0]?.state).toEqual({ parent_location_id: null })
    expect(plan.report.newLocations[0]).toMatchObject({ parent: LOOP_A, parentDropped: true })
    expect(warnSpy).toHaveBeenCalledWith('classifier.create_parent_dropped', {
      handle: 'new:cellar',
      parent: LOOP_A,
      cause: 'chain-broken',
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
    expect(createActions(plan.creates).map((a) => a.source)).toEqual(['per_turn_classifier'])
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
        state: { parent_location_id: null },
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
})

describe('skipTurnCreates', () => {
  it('creates nothing, reports every create dropped, and drops each handle where it stands', () => {
    const plan = skipTurnCreates({
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
    })
    expect(plan.block).toEqual({
      sceneEntities: [HERO],
      transfers: { items: [{ id: OLD_KEY, to: HERO, slot: 'equipped_items' }], stackables: [] },
      worldTimeDelta: 5,
    })
    expect(plan.creates).toEqual([])
    expect(plan.createdRows).toEqual([])
    expect(plan.reusedIds).toEqual([])
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
