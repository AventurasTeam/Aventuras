import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { buildPiggybackActions } from './apply'
import { parseStateBlock } from './parse'
import type { ParsedStateBlock } from './types'

function mockEntity(overrides: Partial<Entity>): Entity {
  return {
    id: 'char_1',
    storyId: 'story_1',
    kind: 'character',
    name: 'Hero',
    aliases: [],
    summary: 'A brave hero',
    status: 'active',
    state: {
      visual: {},
      traits: [],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      stackables: {},
      faction_id: null,
      lastSeenAt: null,
    },
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as Entity
}

describe('buildPiggybackActions', () => {
  const previousMetadata = {
    sceneEntities: ['char_1'],
    currentLocationId: 'loc_1',
    worldTime: 100,
  }

  it('resolves scene metadata correctly with defaults and summary', () => {
    const block: ParsedStateBlock = {
      worldTimeDelta: 30,
      summary: 'Scene summary',
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata).toEqual({
      sceneEntities: ['char_1'],
      currentLocationId: 'loc_1',
      worldTime: 130,
      summary: 'Scene summary',
    })
  })

  it('promotes staged entities named in sceneEntities', () => {
    const stagedChar = mockEntity({ id: 'char_staged', status: 'staged' })
    const activeChar = mockEntity({ id: 'char_active', status: 'active' })

    const block: ParsedStateBlock = {
      sceneEntities: ['char_staged', 'char_active'],
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [stagedChar, activeChar],
      previousMetadata,
      branchId: 'main',
    })

    const promoteActions = result.actions.filter((a) => a.kind === 'promoteStagedEntity')
    expect(promoteActions).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged' },
      },
    ])
  })

  // parseIdList takes the model's list verbatim, so a repeated id reaches this fold.
  // Two promotes for one entity claim entities.status twice, which applyDeltaActionGroup
  // rejects outright, and the repeat would otherwise persist into metadata and feed the
  // next turn's fold as well as the scene editor's sameMembers compare.
  it('collapses a repeated id in the block to one promote and one scene slot', () => {
    const stagedChar = mockEntity({ id: 'char_staged', status: 'staged' })

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block: { sceneEntities: ['char_staged', 'char_1', 'char_staged'] },
      entities: [stagedChar, mockEntity({ id: 'char_1' })],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.actions.filter((a) => a.kind === 'promoteStagedEntity')).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged' },
      },
    ])
    // First-occurrence order, not sorted: the state panel renders emission order.
    expect(result.metadata.sceneEntities).toEqual(['char_staged', 'char_1'])
  })

  it('updates location tracking for characters entering scene', () => {
    const char1 = mockEntity({ id: 'char_1', kind: 'character' })
    const char2 = mockEntity({ id: 'char_2', kind: 'character' })
    const loc2 = mockEntity({ id: 'loc_2', kind: 'location' })

    const block: ParsedStateBlock = {
      sceneEntities: ['char_1', 'char_2'],
      currentLocation: 'loc_2',
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_2',
      block,
      entities: [char1, char2, loc2],
      previousMetadata,
      branchId: 'main',
    })

    const trackingActions = result.actions.filter((a) => a.kind === 'updateEntityLocationTracking')
    expect(trackingActions).toEqual([
      {
        kind: 'updateEntityLocationTracking',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', currentLocationId: 'loc_2' },
      },
      {
        kind: 'updateEntityLocationTracking',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_2', currentLocationId: 'loc_2' },
      },
    ])
  })

  it('updates location tracking with lastSeenAt for characters leaving scene', () => {
    const char1 = mockEntity({ id: 'char_1', kind: 'character' })
    const char2 = mockEntity({ id: 'char_2', kind: 'character' })
    const loc2 = mockEntity({ id: 'loc_2', kind: 'location' })

    const block: ParsedStateBlock = {
      sceneEntities: ['char_2'],
      currentLocation: 'loc_2',
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_2',
      block,
      entities: [char1, char2, loc2],
      previousMetadata,
      branchId: 'main',
    })

    const trackingActions = result.actions.filter((a) => a.kind === 'updateEntityLocationTracking')
    expect(trackingActions).toContainEqual({
      kind: 'updateEntityLocationTracking',
      source: 'ai_classifier',
      payload: {
        branchId: 'main',
        id: 'char_1',
        // The scene moved to loc_2 without them; they stay where the anchor puts them.
        currentLocationId: 'loc_1',
        lastSeenAt: {
          entryId: 'entry_2',
          locationId: 'loc_1',
          worldTime: 100,
        },
      },
    })
  })

  it('generates visual state update actions', () => {
    const block: ParsedStateBlock = {
      visualChanges: [
        { id: 'char_1', type: 'attire', text: 'Iron Plate Armor' },
        { id: 'char_1', type: 'face', text: 'Scarred cheek' },
      ],
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [mockEntity({ id: 'char_1' })],
      previousMetadata,
      branchId: 'main',
    })

    const visualActions = result.actions.filter((a) => a.kind === 'updateEntityVisualState')
    expect(visualActions).toEqual([
      {
        kind: 'updateEntityVisualState',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', visual: { attire: 'Iron Plate Armor' } },
      },
      {
        kind: 'updateEntityVisualState',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', visual: { face: 'Scarred cheek' } },
      },
    ])
  })

  it('handles item transfers between characters', () => {
    const char1 = mockEntity({
      id: 'char_1',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: ['sword_1'],
        inventory: ['potion_1'],
        faction_id: null,
        lastSeenAt: null,
      },
    })
    const char2 = mockEntity({
      id: 'char_2',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        faction_id: null,
        lastSeenAt: null,
      },
    })

    const block: ParsedStateBlock = {
      transfers: {
        items: [
          { id: 'sword_1', slot: 'inventory', from: 'char_1', to: 'char_2' },
          { id: 'potion_1', slot: 'equipped_items', from: 'char_1' },
        ],
        stackables: [],
      },
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [char1, char2],
      previousMetadata,
      branchId: 'main',
    })

    const itemActions = result.actions.filter((a) => a.kind === 'updateEntityInventory')
    expect(itemActions).toEqual([
      {
        kind: 'updateEntityInventory',
        source: 'ai_classifier',
        payload: {
          branchId: 'main',
          id: 'char_1',
          equipped_items: [],
          inventory: [],
        },
      },
      {
        kind: 'updateEntityInventory',
        source: 'ai_classifier',
        payload: {
          branchId: 'main',
          id: 'char_2',
          equipped_items: [],
          inventory: ['sword_1'],
        },
      },
    ])
  })

  it('handles stackable transfers and key removal when amount reaches zero', () => {
    const char1 = mockEntity({
      id: 'char_1',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        stackables: { gold: 50, arrows: 10 },
        faction_id: null,
        lastSeenAt: null,
      },
    })
    const char2 = mockEntity({
      id: 'char_2',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        stackables: { gold: 10 },
        faction_id: null,
        lastSeenAt: null,
      },
    })

    const block: ParsedStateBlock = {
      transfers: {
        items: [],
        stackables: [
          { key: 'gold', amount: 20, from: 'char_1', to: 'char_2' },
          { key: 'arrows', amount: 10, from: 'char_1' },
        ],
      },
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [char1, char2],
      previousMetadata,
      branchId: 'main',
    })

    const stackableActions = result.actions.filter((a) => a.kind === 'updateEntityStackables')
    expect(stackableActions).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: {
          branchId: 'main',
          id: 'char_1',
          stackables: { gold: 30 },
        },
      },
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: {
          branchId: 'main',
          id: 'char_2',
          stackables: { gold: 30 },
        },
      },
    ])
  })

  describe('malformed block fixture matrix', () => {
    it('handles truncated tag: worldTime is finite number and valid fields still apply', () => {
      const raw = `<state>
  <scene_entities>char_1</scene_entities>
  <world_time_delta>45</world_time_delta>
  <visual_changes>
    <entity id="char_1" type="attire">incomplete string
</state>`
      const parsed = parseStateBlock(raw)
      expect(parsed.blockFound).toBe(true)
      expect(parsed.failures).toHaveLength(1)

      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: parsed.block,
        entities: [],
        previousMetadata,
        branchId: 'main',
      })

      expect(Number.isFinite(result.metadata.worldTime)).toBe(true)
      expect(result.metadata.worldTime).toBe(145)
      expect(result.metadata.sceneEntities).toEqual(['char_1'])
    })

    it('handles bad JSON-ish interior: worldTime resolves to finite number via repair and valid fields apply', () => {
      const raw = `<state>
  <scene_entities>char_1</scene_entities>
  <world_time_delta> 90, // seconds </world_time_delta>
  <summary>Arrival at campsite</summary>
</state>`
      const parsed = parseStateBlock(raw)
      expect(parsed.blockFound).toBe(true)

      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: parsed.block,
        entities: [],
        previousMetadata,
        branchId: 'main',
      })

      expect(Number.isFinite(result.metadata.worldTime)).toBe(true)
      expect(result.metadata.worldTime).toBe(190)
      expect(result.metadata.summary).toBe('Arrival at campsite')
    })

    it('handles unknown placeholder: worldTime resolves to finite number and valid fields apply', () => {
      const raw = `<state>
  <scene_entities>char_1, unknown_entity_id</scene_entities>
  <world_time_delta>15</world_time_delta>
  <current_location>loc_2</current_location>
</state>`
      const parsed = parseStateBlock(raw)

      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: parsed.block,
        entities: [],
        previousMetadata,
        branchId: 'main',
      })

      expect(Number.isFinite(result.metadata.worldTime)).toBe(true)
      expect(result.metadata.worldTime).toBe(115)
      expect(result.metadata.sceneEntities).toEqual(['char_1', 'unknown_entity_id'])
      // loc_2 resolves to nothing in this fixture's empty entity set, so it is
      // refused and the previous location carries forward. sceneEntities has no
      // such guard: an unresolvable id there is inert, while a bad location id
      // is written onto every in-scene character's state.
      expect(result.metadata.currentLocationId).toBe('loc_1')
    })
  })

  // The block is model output: nothing constrains the id it answers with to be a
  // location, and an accepted character id would be written as
  // state.current_location_id on every in-scene character.
  it('refuses a current_location naming an entity that is not a location', () => {
    const char1 = mockEntity({ id: 'char_1', kind: 'character' })
    const item = mockEntity({ id: 'item_1', kind: 'item' })

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_2',
      block: { sceneEntities: ['char_1'], currentLocation: 'item_1' },
      entities: [char1, item],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.currentLocationId).toBe('loc_1')
    const tracking = result.actions.filter((a) => a.kind === 'updateEntityLocationTracking')
    expect(tracking).toEqual([
      {
        kind: 'updateEntityLocationTracking',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', currentLocationId: 'loc_1' },
      },
    ])
  })

  it('accepts a current_location that resolves to a location', () => {
    const char1 = mockEntity({ id: 'char_1', kind: 'character' })
    const loc2 = mockEntity({ id: 'loc_2', kind: 'location' })

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_2',
      block: { sceneEntities: ['char_1'], currentLocation: 'loc_2' },
      entities: [char1, loc2],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.currentLocationId).toBe('loc_2')
  })

  it('promotes staged entity on first emission in scene_entities, and produces no promoteStagedEntity action on second emission when entity is already active', () => {
    const stagedChar = mockEntity({ id: 'char_staged', status: 'staged' })

    const firstBlock: ParsedStateBlock = {
      sceneEntities: ['char_staged'],
    }

    const firstResult = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block: firstBlock,
      entities: [stagedChar],
      previousMetadata,
      branchId: 'main',
    })

    const firstPromotes = firstResult.actions.filter((a) => a.kind === 'promoteStagedEntity')
    expect(firstPromotes).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged' },
      },
    ])

    const activeChar = mockEntity({ id: 'char_staged', status: 'active' })
    const secondBlock: ParsedStateBlock = {
      sceneEntities: ['char_staged'],
    }

    const secondResult = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_2',
      block: secondBlock,
      entities: [activeChar],
      previousMetadata: firstResult.metadata,
      branchId: 'main',
    })

    const secondPromotes = secondResult.actions.filter((a) => a.kind === 'promoteStagedEntity')
    expect(secondPromotes).toEqual([])
  })

  it('safely ignores visual changes and transfers for non-existent entity IDs', () => {
    const activeChar = mockEntity({ id: 'char_kael', status: 'active' })
    const block: ParsedStateBlock = {
      visualChanges: [
        { id: 'Andrea', type: 'attire', text: 'blue cloak' },
        { id: 'char_kael', type: 'attire', text: 'leather jacket' },
      ],
      transfers: {
        items: [{ id: 'item_blade', from: 'Andrea', to: 'char_kael', slot: 'inventory' }],
        stackables: [{ key: 'coins', amount: 5, from: 'Andrea', to: 'char_kael' }],
      },
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [activeChar],
      previousMetadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
      branchId: 'main',
    })

    const visualActions = result.actions.filter((a) => a.kind === 'updateEntityVisualState')
    expect(visualActions).toEqual([
      {
        kind: 'updateEntityVisualState',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_kael', visual: { attire: 'leather jacket' } },
      },
    ])

    const inventoryActions = result.actions.filter((a) => a.kind === 'updateEntityInventory')
    expect(inventoryActions).toEqual([
      {
        kind: 'updateEntityInventory',
        source: 'ai_classifier',
        payload: {
          branchId: 'main',
          id: 'char_kael',
          equipped_items: [],
          inventory: ['item_blade'],
        },
      },
    ])

    const stackableActions = result.actions.filter((a) => a.kind === 'updateEntityStackables')
    expect(stackableActions).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_kael', stackables: { coins: 5 } },
      },
    ])
  })

  it('drops visual changes and transfers targeting a non-character entity even though it exists', () => {
    const activeChar = mockEntity({ id: 'char_kael', status: 'active' })
    const location = mockEntity({
      id: 'loc_keep',
      kind: 'location',
      status: 'active',
      state: { parent_location_id: null },
    })
    const block: ParsedStateBlock = {
      visualChanges: [{ id: 'loc_keep', type: 'attire', text: 'weathered stonework' }],
      transfers: {
        items: [{ id: 'item_blade', from: 'char_kael', to: 'loc_keep', slot: 'inventory' }],
        stackables: [{ key: 'coins', amount: 5, from: 'char_kael', to: 'loc_keep' }],
      },
    }

    const result = buildPiggybackActions({
      source: 'ai_classifier',
      entryId: 'entry_1',
      block,
      entities: [activeChar, location],
      previousMetadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
      branchId: 'main',
    })

    expect(result.actions.filter((a) => a.kind === 'updateEntityVisualState')).toEqual([])
    // char_kael is still the `from` side of both transfers — draining its
    // inventory/stackables is valid even though the `to` side (a location) is dropped.
    expect(result.actions.filter((a) => a.kind === 'updateEntityInventory')).toEqual([
      {
        kind: 'updateEntityInventory',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_kael', equipped_items: [], inventory: [] },
      },
    ])
    expect(result.actions.filter((a) => a.kind === 'updateEntityStackables')).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_kael', stackables: {} },
      },
    ])
  })

  // These two decisions were previously visible only in classifier.* warn logs, which
  // are a no-op unless diagnostics is on. Returning them is what lets the report record
  // the cause instead of leaving the reader to guess it from a difference.
  describe('applied outcomes', () => {
    it('reports the clamped delta while metadata carries the clamped total', () => {
      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: { worldTimeDelta: -600 },
        entities: [],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.worldTimeDelta).toBe(0)
      expect(result.metadata.worldTime).toBe(previousMetadata.worldTime)
    })

    it('passes an unclamped delta through unchanged', () => {
      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: { worldTimeDelta: 30 },
        entities: [],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.worldTimeDelta).toBe(30)
      expect(result.applied.currentLocationRejected).toBe(false)
    })

    it('flags a location the model named that is not a location', () => {
      const sword = mockEntity({ id: 'item_sword', kind: 'item', name: 'Sword' })
      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: { currentLocation: 'item_sword' },
        entities: [sword],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.currentLocationRejected).toBe(true)
      // The rejection is why the previous location was kept, so both must agree.
      expect(result.metadata.currentLocationId).toBe(previousMetadata.currentLocationId)
    })

    it('does not flag a location the model named correctly', () => {
      const keep = mockEntity({ id: 'loc_keep', kind: 'location', name: 'The Keep' })
      const result = buildPiggybackActions({
        source: 'ai_classifier',
        entryId: 'entry_1',
        block: { currentLocation: 'loc_keep' },
        entities: [keep],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.currentLocationRejected).toBe(false)
      expect(result.metadata.currentLocationId).toBe('loc_keep')
    })
  })
})
