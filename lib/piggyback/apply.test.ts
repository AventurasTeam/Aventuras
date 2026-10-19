import { describe, expect, it, vi } from 'vitest'

import {
  emptyEntityState,
  entityStateSchemaForKind,
  type CharacterState,
  type Entity,
} from '@/lib/db'
import { logger, type Logger } from '@/lib/diagnostics'

import { buildPiggybackActions } from './apply'
import { parseStateBlock } from './parse'
import {
  VISUAL_TEXT_MAX,
  type ParsedStateBlock,
  type PlannedStateBlock,
  type PlannedTurn,
} from './types'

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

const spyLog = (): Logger => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() })

// Cast, not planned: the planner hands on a block that declared no creates unchanged.
function planned(
  block: ParsedStateBlock,
  rows: { createdRows?: readonly Entity[]; reusedIds?: readonly string[] } = {},
): PlannedTurn {
  const { newLocations, newItems, ...rest } = block
  if (newLocations !== undefined || newItems !== undefined)
    throw new Error('a planned block declares no creates')
  return {
    block: rest as PlannedStateBlock,
    createdRows: rows.createdRows ?? [],
    reusedIds: rows.reusedIds ?? [],
    report: { newLocations: [], newItems: [] },
  }
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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

  it('carries an emitted retrievalQueries onto the entry metadata', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: ['marsh nobility'] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.retrievalQueries).toEqual(['marsh nobility'])
  })

  it('leaves retrievalQueries absent when the block emitted none', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata).not.toHaveProperty('retrievalQueries')
  })

  // The parser cannot produce [] today, but the fallback classifier's schema can.
  it('leaves retrievalQueries absent when the block emitted an empty array', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: [] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata).not.toHaveProperty('retrievalQueries')
  })

  // The next four pin the normalisation the fallback classifier's schema does not do:
  // its .max() only counts, so blanks and repeats arrive here unfiltered.
  it('stores a repeated query once', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: ['marsh nobility', 'marsh nobility'] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.retrievalQueries).toEqual(['marsh nobility'])
  })

  it('drops empty and whitespace-only queries', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: ['', '   ', 'House Eldrin sigil'] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.retrievalQueries).toEqual(['House Eldrin sigil'])
  })

  it('caps a four-query emission at MAX_RETRIEVAL_QUERIES', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: ['one', 'two', 'three', 'four'] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata.retrievalQueries).toEqual(['one', 'two', 'three'])
  })

  it('leaves retrievalQueries absent when every emitted query is blank', () => {
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: [], retrievalQueries: ['', '  '] }),
      entities: [],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.metadata).not.toHaveProperty('retrievalQueries')
  })

  it('promotes staged entities named in sceneEntities', () => {
    const stagedChar = mockEntity({ id: 'char_staged', status: 'staged' })
    const activeChar = mockEntity({ id: 'char_active', status: 'active' })

    const block: ParsedStateBlock = {
      sceneEntities: ['char_staged', 'char_active'],
    }

    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
      entities: [stagedChar, activeChar],
      previousMetadata,
      branchId: 'main',
    })

    const promoteActions = result.actions.filter((a) => a.kind === 'promoteStagedEntity')
    expect(promoteActions).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged', proseEntryId: null },
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({ sceneEntities: ['char_staged', 'char_1', 'char_staged'] }),
      entities: [stagedChar, mockEntity({ id: 'char_1' })],
      previousMetadata,
      branchId: 'main',
    })

    expect(result.actions.filter((a) => a.kind === 'promoteStagedEntity')).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged', proseEntryId: null },
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_2',
      turn: planned(block),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_2',
      turn: planned(block),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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

  // Truncate rather than drop: an over-long note would fail every later updateEntity that
  // re-validates the whole state, a delete's ref clear included.
  describe('visual text cap', () => {
    const visualText = (block: ParsedStateBlock, log: Logger = logger): string | undefined => {
      const [action] = buildPiggybackActions({
        log,
        source: 'per_turn_classifier',
        entryId: 'entry_1',
        turn: planned(block),
        entities: [mockEntity({ id: 'char_1' })],
        previousMetadata,
        branchId: 'main',
      }).actions.filter((a) => a.kind === 'updateEntityVisualState')
      return action?.kind === 'updateEntityVisualState' ? action.payload.visual.physique : undefined
    }
    // The fallback classifier's schema leaves `text` a bare string, so its block reaches
    // apply.ts with the note exactly as the model wrote it.
    const fallbackBlock = (text: string): ParsedStateBlock => ({
      sceneEntities: ['char_1'],
      worldTimeDelta: 0,
      visualChanges: [{ id: 'char_1', type: 'physique', text }],
      transfers: { items: [], stackables: [] },
    })

    it('truncates an over-cap fallback classifier note to the schema cap', () => {
      const text = visualText(fallbackBlock('a'.repeat(600)))
      expect(text).toHaveLength(VISUAL_TEXT_MAX)
      expect(
        entityStateSchemaForKind('character').safeParse({
          ...emptyEntityState('character'),
          visual: { physique: text },
        }).success,
      ).toBe(true)
    })

    it('truncates an over-cap tagged-block note to the schema cap', () => {
      const { block } = parseStateBlock(
        `<state><visual_changes><entity id="char_1" type="physique">${'a'.repeat(600)}</entity></visual_changes></state>`,
      )
      expect(visualText(block)).toHaveLength(VISUAL_TEXT_MAX)
    })

    it('leaves a note at exactly the cap unchanged', () => {
      const exact = 'b'.repeat(VISUAL_TEXT_MAX)
      expect(visualText(fallbackBlock(exact))).toBe(exact)
    })

    it('does not split a surrogate pair when the cut lands mid-emoji', () => {
      const emoji = '\u{1F600}' // 2 UTF-16 units; index 499 is the high surrogate
      expect(visualText(fallbackBlock('a'.repeat(499) + emoji))).toBe('a'.repeat(499))
    })

    // piggyback.md → Trailing block format: back to the last sentence or clause boundary inside
    // the bound, else the last whitespace, mid-word only as a last resort.
    it('cuts back to the last sentence end inside the bound, keeping the period', () => {
      const text = `${'a'.repeat(300)}. ${'b'.repeat(150)}. ${'c'.repeat(100)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(300)}. ${'b'.repeat(150)}.`)
    })

    it.each([',', ';'])('cuts back to the last %s inside the bound, dropping it', (mark) => {
      const text = `${'a'.repeat(200)}. ${'b'.repeat(250)}${mark} ${'c'.repeat(100)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(200)}. ${'b'.repeat(250)}`)
    })

    // A decimal point or an abbreviation's dot has no whitespace after it, and ends nothing.
    it('reads a mark with no whitespace after it as part of a word', () => {
      const text = `Stands 1.8 m tall ${'and lean '.repeat(60)}`
      const cut = visualText(fallbackBlock(text)) ?? ''
      expect(cut.startsWith('Stands 1.8 m tall and lean')).toBe(true)
      expect(cut.length).toBeGreaterThan(450)
    })

    it('takes no boundary from the first half of the bound, cutting at the last whitespace', () => {
      const text = `Tall, ${'lean and weathered '.repeat(30)}`
      const cut = visualText(fallbackBlock(text)) ?? ''
      expect(cut.length).toBeGreaterThan(450)
      expect(cut.startsWith('Tall, lean')).toBe(true)
    })

    it('ignores a boundary past the bound, falling back to the last whitespace', () => {
      const text = `${'a '.repeat(240)}${'b'.repeat(40)}, more.`
      const cut = visualText(fallbackBlock(text))
      expect(cut).toBe('a '.repeat(240).trimEnd())
    })

    it("logs the cut on the run's logger with the entry, the producer, the entity, the category and both lengths", () => {
      const log = spyLog()
      visualText(fallbackBlock(`${'a'.repeat(300)}. ${'b'.repeat(300)}`), log)
      expect(log.warn).toHaveBeenCalledWith('classifier.visual_truncated', {
        entryId: 'entry_1',
        source: 'per_turn_classifier',
        entityId: 'char_1',
        type: 'physique',
        length: 602,
        keptLength: 301,
      })
      vi.mocked(log.warn).mockClear()
      visualText(fallbackBlock('b'.repeat(VISUAL_TEXT_MAX)), log)
      expect(log.warn).not.toHaveBeenCalled()
    })
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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

  it('counts a stackable keyed like an Object.prototype member', () => {
    const state = (stackables: Record<string, number>): CharacterState => ({
      visual: {},
      traits: [],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      stackables,
      faction_id: null,
      lastSeenAt: null,
    })
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({
        transfers: {
          items: [],
          stackables: [
            { key: 'constructor', amount: 1, from: 'char_1', to: 'char_2' },
            { key: '__proto__', amount: 2, to: 'char_2' },
          ],
        },
      }),
      entities: [
        mockEntity({ id: 'char_1', state: state({ constructor: 2 }) }),
        mockEntity({ id: 'char_2', state: state({}) }),
      ],
      previousMetadata,
      branchId: 'main',
    })
    const counts = result.actions.flatMap((a) =>
      a.kind === 'updateEntityStackables'
        ? [[a.payload.id, Object.entries(a.payload.stackables)]]
        : [],
    )
    expect(counts).toEqual([
      ['char_1', [['constructor', 1]]],
      [
        'char_2',
        [
          ['constructor', 1],
          ['__proto__', 2],
        ],
      ],
    ])
  })

  it("folds a holder's mixed-case stackable keys into one on the first transfer that touches it", () => {
    const holder = mockEntity({
      id: 'char_1',
      state: {
        visual: {},
        traits: [],
        drives: [],
        current_location_id: null,
        equipped_items: [],
        inventory: [],
        stackables: { Gold: 3, gold: 4, ' ': 2 },
        faction_id: null,
        lastSeenAt: null,
      },
    })
    const result = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({
        transfers: { items: [], stackables: [{ key: 'gold', amount: 1, to: 'char_1' }] },
      }),
      entities: [holder],
      previousMetadata,
      branchId: 'main',
    })
    expect(result.actions.filter((a) => a.kind === 'updateEntityStackables')).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', stackables: { gold: 8 } },
      },
    ])
  })

  describe('one position per item', () => {
    const holding = (id: string, over: Partial<CharacterState>) =>
      mockEntity({
        id,
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
          ...over,
        },
      })
    const run = (block: ParsedStateBlock, entities: Entity[]) =>
      buildPiggybackActions({
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned(block),
        entities,
        previousMetadata,
        branchId: 'main',
      }).actions

    it('takes the item off a holder `from` did not name and clears where it lay', () => {
      const rope = mockEntity({
        id: 'item_rope',
        kind: 'item',
        state: { at_location_id: 'loc_hollow' },
      })
      const actions = run(
        {
          transfers: {
            items: [{ id: 'item_rope', to: 'char_2', slot: 'inventory' }],
            stackables: [],
          },
        },
        [holding('char_2', {}), holding('char_3', { inventory: ['item_rope', 'item_key'] }), rope],
      )
      expect(
        actions.filter((a) => a.kind !== 'updateEntityInventory' || a.payload.id !== 'char_2'),
      ).toEqual([
        {
          kind: 'updateEntityInventory',
          source: 'ai_classifier',
          payload: { branchId: 'main', id: 'char_3', equipped_items: [], inventory: ['item_key'] },
        },
        {
          kind: 'updateItemPosition',
          source: 'ai_classifier',
          payload: { branchId: 'main', id: 'item_rope', atLocationId: null },
        },
      ])
    })

    it("moves an item between one holder's slots instead of listing it in both", () => {
      const actions = run(
        {
          transfers: {
            items: [{ id: 'item_blade', to: 'char_2', slot: 'equipped_items' }],
            stackables: [],
          },
        },
        [holding('char_2', { inventory: ['item_blade'] })],
      )
      expect(actions).toEqual([
        {
          kind: 'updateEntityInventory',
          source: 'ai_classifier',
          payload: {
            branchId: 'main',
            id: 'char_2',
            equipped_items: ['item_blade'],
            inventory: [],
          },
        },
      ])
    })
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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

  // data-model.md → Stackable items: the prose stays true for the payee, and the shortfall shows.
  it('credits the payee in full on a shortfall, clamps the payer at zero and logs it', () => {
    const holder = (id: string, stackables: Record<string, number>) =>
      mockEntity({ id, state: { ...emptyEntityState('character'), stackables } })
    const log = spyLog()
    const result = buildPiggybackActions({
      log,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({
        transfers: {
          items: [],
          stackables: [
            { key: 'gold', amount: 20, from: 'char_1', to: 'char_2' },
            { key: 'arrows', amount: 2, from: 'char_1' },
          ],
        },
      }),
      entities: [holder('char_1', { gold: 5, arrows: 6 }), holder('char_2', { gold: 1 })],
      previousMetadata,
      branchId: 'main',
    })

    expect(
      result.actions.flatMap((a) =>
        a.kind === 'updateEntityStackables' ? [[a.payload.id, a.payload.stackables]] : [],
      ),
    ).toEqual([
      ['char_1', { arrows: 4 }],
      ['char_2', { gold: 21 }],
    ])
    const shortfalls = vi
      .mocked(log.warn)
      .mock.calls.filter(([event]) => event === 'classifier.stackable_shortfall')
    expect(shortfalls).toEqual([
      [
        'classifier.stackable_shortfall',
        {
          entryId: 'entry_1',
          source: 'ai_classifier',
          entityId: 'char_1',
          key: 'gold',
          amount: 20,
          balance: 5,
        },
      ],
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
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned(parsed.block),
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
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned(parsed.block),
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
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned(parsed.block),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_2',
      turn: planned({ sceneEntities: ['char_1'], currentLocation: 'item_1' }),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_2',
      turn: planned({ sceneEntities: ['char_1'], currentLocation: 'loc_2' }),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(firstBlock),
      entities: [stagedChar],
      previousMetadata,
      branchId: 'main',
    })

    const firstPromotes = firstResult.actions.filter((a) => a.kind === 'promoteStagedEntity')
    expect(firstPromotes).toEqual([
      {
        kind: 'promoteStagedEntity',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_staged', proseEntryId: null },
      },
    ])

    const activeChar = mockEntity({ id: 'char_staged', status: 'active' })
    const secondBlock: ParsedStateBlock = {
      sceneEntities: ['char_staged'],
    }

    const secondResult = buildPiggybackActions({
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_2',
      turn: planned(secondBlock),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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
      log: logger,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned(block),
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
    it("reports the clamped delta while metadata carries the clamped total, warning on the run's logger", () => {
      const log = spyLog()
      const result = buildPiggybackActions({
        log,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned({ worldTimeDelta: -600 }),
        entities: [],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.worldTimeDelta).toBe(0)
      expect(result.metadata.worldTime).toBe(previousMetadata.worldTime)
      expect(log.warn).toHaveBeenCalledWith('classifier.delta_clamped', {
        originalDelta: -600,
        finalDelta: 0,
        entryId: 'entry_1',
      })
    })

    it('passes an unclamped delta through unchanged', () => {
      const result = buildPiggybackActions({
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned({ worldTimeDelta: 30 }),
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
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned({ currentLocation: 'item_sword' }),
        entities: [sword],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.currentLocationRejected).toBe(true)
      // The rejection is why the previous location was kept, so both must agree.
      expect(result.metadata.currentLocationId).toBe(previousMetadata.currentLocationId)
    })

    // piggyback.md → A bad ref in the two writers: a retired place can't be entered.
    it('rejects a retired location, logged, and keeps the previous one', () => {
      const log = spyLog()
      const sunk = mockEntity({
        id: 'loc_sunk',
        kind: 'location',
        name: 'Saltmere',
        status: 'retired',
      })
      const result = buildPiggybackActions({
        log,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned({ currentLocation: 'loc_sunk' }),
        entities: [sunk],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.currentLocationRejected).toBe(true)
      expect(result.metadata.currentLocationId).toBe(previousMetadata.currentLocationId)
      expect(log.warn).toHaveBeenCalledWith('classifier.current_location_rejected', {
        entryId: 'entry_1',
        currentLocation: 'loc_sunk',
        kind: 'location',
        status: 'retired',
      })
    })

    it('does not flag a location the model named correctly', () => {
      const keep = mockEntity({ id: 'loc_keep', kind: 'location', name: 'The Keep' })
      const result = buildPiggybackActions({
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        turn: planned({ currentLocation: 'loc_keep' }),
        entities: [keep],
        previousMetadata,
        branchId: 'main',
      })
      expect(result.applied.currentLocationRejected).toBe(false)
      expect(result.metadata.currentLocationId).toBe('loc_keep')
    })
  })
})

// piggyback.md → New locations and items.
describe("buildPiggybackActions with this turn's creates", () => {
  const previousMetadata = { sceneEntities: ['char_1'], currentLocationId: 'loc_1', worldTime: 100 }
  const hero = mockEntity({ id: 'char_1' })
  const docks = mockEntity({
    id: 'loc_docks',
    kind: 'location',
    name: 'the Docks',
    state: { parent_location_id: null },
  })
  const mill = mockEntity({
    id: 'loc_mill',
    kind: 'location',
    name: 'the Mill',
    status: 'staged',
    state: { parent_location_id: null },
  })
  const build = ({
    block,
    createdRows,
    reusedIds,
    ...args
  }: Partial<Omit<Parameters<typeof buildPiggybackActions>[0], 'turn'>> & {
    block: ParsedStateBlock
    createdRows?: readonly Entity[]
    reusedIds?: readonly string[]
  }) =>
    buildPiggybackActions({
      log: logger,
      source: 'piggyback_tagged_block',
      entryId: 'entry_2',
      turn: planned(block, { createdRows, reusedIds }),
      entities: [hero],
      previousMetadata,
      branchId: 'main',
      ...args,
    })
  const promotes = (result: ReturnType<typeof buildPiggybackActions>) =>
    result.actions.filter((a) => a.kind === 'promoteStagedEntity')
  const promoteOf = (id: string) => ({
    kind: 'promoteStagedEntity',
    source: 'piggyback_tagged_block',
    payload: { branchId: 'main', id, proseEntryId: null },
  })

  it('accepts a location this turn creates as the scene, and moves the scene there', () => {
    const result = build({
      block: { sceneEntities: ['char_1'], currentLocation: 'loc_docks' },
      createdRows: [docks],
    })
    expect(result.applied.currentLocationRejected).toBe(false)
    expect(result.metadata.currentLocationId).toBe('loc_docks')
    expect(result.actions.filter((a) => a.kind === 'updateEntityLocationTracking')).toEqual([
      {
        kind: 'updateEntityLocationTracking',
        source: 'piggyback_tagged_block',
        payload: { branchId: 'main', id: 'char_1', currentLocationId: 'loc_docks' },
      },
    ])
  })

  // The control for the case above: without the planner's row the id is unknown.
  it('refuses the same id when the turn planned no such row', () => {
    const result = build({ block: { sceneEntities: ['char_1'], currentLocation: 'loc_docks' } })
    expect(result.applied.currentLocationRejected).toBe(true)
    expect(result.metadata.currentLocationId).toBe('loc_1')
  })

  it('moves a new item into a holder with no position write', () => {
    const key = mockEntity({
      id: 'item_key',
      kind: 'item',
      name: 'rusted key',
      state: { at_location_id: null },
    })
    const result = build({
      block: {
        transfers: { items: [{ id: 'item_key', slot: 'inventory', to: 'char_1' }], stackables: [] },
      },
      createdRows: [key],
    })
    expect(
      result.actions.filter(
        (a) => a.kind === 'updateEntityInventory' || a.kind === 'updateItemPosition',
      ),
    ).toEqual([
      {
        kind: 'updateEntityInventory',
        source: 'piggyback_tagged_block',
        payload: { branchId: 'main', id: 'char_1', equipped_items: [], inventory: ['item_key'] },
      },
    ])
  })

  it('promotes a staged location the block names as the scene', () => {
    const result = build({
      block: { sceneEntities: ['char_1'], currentLocation: 'loc_mill' },
      entities: [hero, mill],
    })
    expect(promotes(result)).toEqual([promoteOf('loc_mill')])
  })

  it('promotes it once when the scene and the reused ids name it too', () => {
    const result = build({
      block: { sceneEntities: ['char_1', 'loc_mill'], currentLocation: 'loc_mill' },
      entities: [hero, mill],
      reusedIds: ['loc_mill'],
    })
    expect(promotes(result)).toEqual([promoteOf('loc_mill')])
  })

  it('promotes a staged row a create reused, and leaves an active one', () => {
    const hall = mockEntity({
      id: 'loc_hall',
      kind: 'location',
      status: 'staged',
      state: { parent_location_id: null },
    })
    const yard = mockEntity({
      id: 'loc_yard',
      kind: 'location',
      state: { parent_location_id: null },
    })
    const result = build({
      block: { sceneEntities: ['char_1'] },
      entities: [hero, hall, yard],
      reusedIds: ['loc_hall', 'loc_yard'],
    })
    expect(promotes(result)).toEqual([promoteOf('loc_hall')])
  })

  // A rejected current_location names no place, so it introduces nothing.
  it('does not promote a staged non-location the block names as the scene', () => {
    const ghost = mockEntity({ id: 'char_ghost', status: 'staged' })
    const result = build({
      block: { sceneEntities: ['char_1'], currentLocation: 'char_ghost' },
      entities: [hero, ghost],
    })
    expect(result.applied.currentLocationRejected).toBe(true)
    expect(promotes(result)).toEqual([])
  })

  // Auto-promote keys on the block naming the place; an inherited location names nothing.
  it('does not promote a staged location the turn only inherited', () => {
    const result = build({
      block: { sceneEntities: ['char_1'] },
      entities: [hero, mill],
      previousMetadata: { ...previousMetadata, currentLocationId: 'loc_mill' },
    })
    expect(result.metadata.currentLocationId).toBe('loc_mill')
    expect(promotes(result)).toEqual([])
  })
})

describe('buildPiggybackActions input', () => {
  it('takes only a block the planner handed on', () => {
    const turn = { ...planned({}), block: { sceneEntities: ['char_1'] } }
    const build = () =>
      buildPiggybackActions({
        log: logger,
        source: 'ai_classifier',
        entryId: 'entry_1',
        // @ts-expect-error a hand-built block was never planned
        turn,
        entities: [],
        previousMetadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
        branchId: 'main',
      })
    expect(build).toBeTypeOf('function')
  })
})
