import { describe, expect, it, vi } from 'vitest'

import {
  emptyEntityState,
  entityStateSchemaForKind,
  type CharacterState,
  type Entity,
} from '@/lib/db'
import { logger, type Logger } from '@/lib/diagnostics'
import { spyLogger } from '@/lib/diagnostics/__tests__/spy-logger'

import { buildPiggybackActions as buildActions } from './apply'
import { parseStateBlock } from './parse'
import {
  VISUAL_TEXT_MAX,
  type ParsedStateBlock,
  type ParsedTransfers,
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

// Most cases show no row with its state; a condition case passes its own set.
function buildPiggybackActions(
  args: Omit<Parameters<typeof buildActions>[0], 'stateShownIds'> & {
    stateShownIds?: ReadonlySet<string>
  },
): ReturnType<typeof buildActions> {
  return buildActions({ ...args, stateShownIds: args.stateShownIds ?? new Set() })
}

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
      transfers: { items: [], stackables: [], drops: [] },
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

    // piggyback.md → Trailing block format: back to the last sentence or clause boundary in the
    // bound's second half, else the last whitespace there, mid-word only as a last resort.
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
      const text = `${'a'.repeat(390)} stands 1.8 m tall ${'b'.repeat(120)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(390)} stands 1.8 m tall`)
    })

    it('takes no boundary from the first half of the bound, cutting at the last whitespace', () => {
      const text = `Tall, ${'lean and weathered '.repeat(30)}`
      const cut = visualText(fallbackBlock(text)) ?? ''
      expect(cut.length).toBeGreaterThan(450)
      expect(cut.startsWith('Tall, lean')).toBe(true)
    })

    // The period sits at index 249, then at 250: either side of the midpoint.
    it('takes no boundary just below the midpoint, cutting at the last whitespace', () => {
      const text = `${'a'.repeat(249)}. ${'b'.repeat(200)} ${'c'.repeat(100)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(249)}. ${'b'.repeat(200)}`)
    })

    it('takes a boundary at the midpoint', () => {
      const text = `${'a'.repeat(250)}. ${'b'.repeat(200)} ${'c'.repeat(100)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(250)}.`)
    })

    // The b-word ends at index 499, then at 500: inside the bound, then one past it.
    it('keeps a last word that ends right at the bound', () => {
      const text = `${'a'.repeat(250)} ${'b'.repeat(249)} ccc`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(250)} ${'b'.repeat(249)}`)
    })

    it('drops a last word that runs one past the bound', () => {
      const text = `${'a'.repeat(250)} ${'b'.repeat(250)} ccc`
      expect(visualText(fallbackBlock(text))).toBe('a'.repeat(250))
    })

    it('ignores a boundary past the bound, falling back to the last whitespace', () => {
      const text = `${'a '.repeat(240)}${'b'.repeat(40)}, more.`
      const cut = visualText(fallbackBlock(text))
      expect(cut).toBe('a '.repeat(240).trimEnd())
    })

    // The space sits at index 249, then at 250: either side of the midpoint.
    it('takes no whitespace below the midpoint, cutting at the bound', () => {
      const text = `${'a'.repeat(249)} ${'b'.repeat(400)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'a'.repeat(249)} ${'b'.repeat(250)}`)
    })

    it('takes whitespace at the midpoint', () => {
      const text = `${'a'.repeat(250)} ${'b'.repeat(400)}`
      expect(visualText(fallbackBlock(text))).toBe('a'.repeat(250))
    })

    it('cuts a CJK note at the bound when its only whitespace sits in the first half', () => {
      const text = `Akira は${'あ'.repeat(800)}`
      expect(visualText(fallbackBlock(text))).toBe(`Akira は${'あ'.repeat(493)}`)
    })

    // The bound's last mark is the 、 at index 499, after the 。 at 490: the last mark wins.
    it('cuts a Japanese note back to its last clause mark, which needs no whitespace after it', () => {
      const text = `Akira は${'黒い外套をまとい、腰には古い剣を下げている。'.repeat(30)}`
      expect(visualText(fallbackBlock(text))).toBe(
        `Akira は${'黒い外套をまとい、腰には古い剣を下げている。'.repeat(22)}黒い外套をまとい`,
      )
    })

    it('cuts a Chinese note back to its last full-width comma, dropping it', () => {
      const text = `李明${'他身穿黑色长袍，腰间挂着一把古老的长剑。'.repeat(30)}`
      expect(visualText(fallbackBlock(text))).toBe(
        `李明${'他身穿黑色长袍，腰间挂着一把古老的长剑。'.repeat(24)}他身穿黑色长袍`,
      )
    })

    it.each(['。', '！', '？'])('cuts back to the last %s inside the bound, keeping it', (mark) => {
      const text = `${'あ'.repeat(300)}${mark}${'い'.repeat(150)} ${'う'.repeat(100)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'あ'.repeat(300)}${mark}`)
    })

    it.each(['、', '，', '；'])(
      'cuts back to the last %s inside the bound, dropping it',
      (mark) => {
        const text = `${'あ'.repeat(300)}${mark}${'い'.repeat(150)} ${'う'.repeat(100)}`
        expect(visualText(fallbackBlock(text))).toBe('あ'.repeat(300))
      },
    )

    it('takes no CJK mark from the first half of the bound, cutting at the bound', () => {
      expect(visualText(fallbackBlock(`黒髪、${'あ'.repeat(800)}`))).toBe(
        `黒髪、${'あ'.repeat(497)}`,
      )
    })

    // The mark sits at index 249, then at 250: either side of the midpoint.
    it('takes no CJK mark just below the midpoint, cutting at the bound', () => {
      const text = `${'あ'.repeat(249)}。${'い'.repeat(400)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'あ'.repeat(249)}。${'い'.repeat(250)}`)
    })

    it('takes a CJK mark at the midpoint', () => {
      const text = `${'あ'.repeat(250)}。${'い'.repeat(400)}`
      expect(visualText(fallbackBlock(text))).toBe(`${'あ'.repeat(250)}。`)
    })

    it("logs the cut on the run's logger with the entry, the producer, the entity, the category and both lengths", () => {
      const log = spyLogger()
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
          { id: 'sword_1', slot: 'inventory', from: 'char_1', to: 'char_2', seq: 0 },
          { id: 'potion_1', slot: 'equipped_items', from: 'char_1', seq: 1 },
        ],
        stackables: [],
        drops: [],
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
          drops: [],
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
        transfers: { items: [], stackables: [{ key: 'gold', amount: 1, to: 'char_1' }], drops: [] },
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

  it('debits a stored key with a line break under the single-spaced key the prompt shows', () => {
    const log = spyLogger()
    const result = buildPiggybackActions({
      log,
      source: 'ai_classifier',
      entryId: 'entry_1',
      turn: planned({
        transfers: {
          items: [],
          stackables: [{ key: 'silver coins', amount: 5, from: 'char_1' }],
          drops: [],
        },
      }),
      entities: [
        mockEntity({
          id: 'char_1',
          state: { ...emptyEntityState('character'), stackables: { 'silver\ncoins': 7 } },
        }),
      ],
      previousMetadata,
      branchId: 'main',
    })
    expect(result.actions.filter((a) => a.kind === 'updateEntityStackables')).toEqual([
      {
        kind: 'updateEntityStackables',
        source: 'ai_classifier',
        payload: { branchId: 'main', id: 'char_1', stackables: { 'silver coins': 2 } },
      },
    ])
    expect(
      vi
        .mocked(log.warn)
        .mock.calls.filter(([event]) => event === 'classifier.stackable_shortfall'),
    ).toEqual([])
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
            items: [{ id: 'item_rope', to: 'char_2', slot: 'inventory', seq: 0 }],
            stackables: [],
            drops: [],
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
            items: [{ id: 'item_blade', to: 'char_2', slot: 'equipped_items', seq: 0 }],
            stackables: [],
            drops: [],
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
        drops: [],
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
    const log = spyLogger()
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
          drops: [],
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
        items: [{ id: 'item_blade', from: 'Andrea', to: 'char_kael', slot: 'inventory', seq: 0 }],
        stackables: [{ key: 'coins', amount: 5, from: 'Andrea', to: 'char_kael' }],
        drops: [],
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

  // piggyback.md → A bad ref in the two writers: a place that isn't the scene's holds nothing, so
  // the blade stays with Kael while the coins, paid to no character, still leave him.
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
        items: [{ id: 'item_blade', from: 'char_kael', to: 'loc_keep', slot: 'inventory', seq: 0 }],
        stackables: [{ key: 'coins', amount: 5, from: 'char_kael', to: 'loc_keep' }],
        drops: [],
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
    expect(result.actions.filter((a) => a.kind === 'updateEntityInventory')).toEqual([])
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
      const log = spyLogger()
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
      const log = spyLogger()
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

    // The fallback keeps a failed fold's record for a field where nothing of its own landed.
    describe('what landed', () => {
      const kael = mockEntity({ id: 'char_kael' })
      const keep = mockEntity({
        id: 'loc_keep',
        kind: 'location',
        state: { parent_location_id: null },
      })
      const landed = (block: ParsedStateBlock, entities: Entity[] = [kael, keep]) => {
        const { applied } = buildPiggybackActions({
          log: logger,
          source: 'per_turn_classifier',
          entryId: 'entry_1',
          turn: planned(block),
          entities,
          previousMetadata,
          branchId: 'main',
        })
        return {
          visualChanges: applied.visualChangesLanded,
          items: applied.itemsLanded,
          stackables: applied.stackablesLanded,
        }
      }
      const transfers = (over: Partial<ParsedTransfers>): ParsedTransfers => ({
        items: [],
        stackables: [],
        drops: [],
        ...over,
      })

      it('counts a visual change only on a character', () => {
        expect(
          landed({
            visualChanges: [
              { id: 'loc_keep', type: 'attire', text: 'weathered stonework' },
              { id: 'char_kael', type: 'hair', text: 'shorn short' },
            ],
          }),
        ).toEqual({ visualChanges: 1, items: 0, stackables: 0 })
      })

      // To the Keep, not the scene's place: a move elsewhere stays prose and leaves the blade held.
      it('counts an item move only when a character gives or takes it', () => {
        expect(
          landed({
            transfers: transfers({
              items: [
                { id: 'item_blade', to: 'loc_keep', slot: 'inventory', seq: 0 },
                { id: 'item_blade', to: 'char_kael', slot: 'inventory', seq: 1 },
                { id: 'item_blade', from: 'char_kael', to: 'loc_keep', slot: 'inventory', seq: 2 },
                { id: 'item_blade', slot: 'inventory', seq: 3 },
              ],
            }),
          }),
        ).toEqual({ visualChanges: 0, items: 1, stackables: 0 })
      })

      it('counts no release from a character who does not hold the item', () => {
        expect(
          landed({
            transfers: transfers({
              items: [{ id: 'item_blade', from: 'char_kael', slot: 'inventory', seq: 0 }],
            }),
          }),
        ).toEqual({ visualChanges: 0, items: 0, stackables: 0 })
      })

      it.each([
        ['counts no take into the slot that already holds it', 'inventory', 0],
        ['counts a take that moves it to the other slot', 'equipped_items', 1],
      ] as const)('%s', (_label, slot, items) => {
        const holding = mockEntity({
          id: 'char_kael',
          state: { ...(kael.state as CharacterState), inventory: ['item_blade'] },
        })
        expect(
          landed(
            {
              transfers: transfers({
                items: [{ id: 'item_blade', to: 'char_kael', slot, seq: 0 }],
              }),
            },
            [holding, keep],
          ),
        ).toEqual({ visualChanges: 0, items, stackables: 0 })
      })

      it('counts a take that lifts it from where its row says it lies', () => {
        const holding = mockEntity({
          id: 'char_kael',
          state: { ...(kael.state as CharacterState), inventory: ['item_blade'] },
        })
        const blade = mockEntity({
          id: 'item_blade',
          kind: 'item',
          state: { at_location_id: 'loc_keep' },
        })
        const items = [{ id: 'item_blade', to: 'char_kael', slot: 'inventory' as const, seq: 0 }]
        expect(landed({ transfers: transfers({ items }) }, [holding, keep, blade])).toEqual({
          visualChanges: 0,
          items: 1,
          stackables: 0,
        })
      })

      it('counts a stackable only when a character pays or gains it', () => {
        expect(
          landed({
            transfers: transfers({
              stackables: [
                { key: 'coins', amount: 5, to: 'loc_keep' },
                { key: 'coins', amount: 5, to: 'char_kael' },
                { key: 'coins', amount: 5, from: 'char_kael' },
                { key: 'coins', amount: 5 },
              ],
            }),
          }),
        ).toEqual({ visualChanges: 0, items: 0, stackables: 2 })
      })
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
        transfers: {
          items: [{ id: 'item_key', slot: 'inventory', to: 'char_1', seq: 0 }],
          stackables: [],
          drops: [],
        },
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

// piggyback.md → Trailing block format.
describe('buildPiggybackActions — conditions and drops', () => {
  const person = (id: string, over: Partial<CharacterState> = {}) =>
    mockEntity({ id, state: { ...emptyEntityState('character'), ...over } })
  const place = (id: string) =>
    mockEntity({ id, kind: 'location', name: id, state: { parent_location_id: null } })
  const thing = (id: string, at: string | null = null) =>
    mockEntity({ id, kind: 'item', name: id, state: { at_location_id: at } })
  const transfers = (over: Partial<ParsedTransfers>): ParsedTransfers => ({
    items: [],
    stackables: [],
    drops: [],
    ...over,
  })

  // The previous entry's scene is both people at the hall; a case states its own scene or location.
  function run(
    block: ParsedStateBlock,
    entities: Entity[],
    over: {
      stateShownIds?: ReadonlySet<string>
      log?: Logger
      previousLocationId?: string | null
      previousScene?: string[]
    } = {},
  ) {
    return buildPiggybackActions({
      log: over.log ?? logger,
      source: 'piggyback_tagged_block',
      entryId: 'entry_1',
      turn: planned(block),
      entities,
      previousMetadata: {
        sceneEntities: over.previousScene ?? ['char_1', 'char_2'],
        currentLocationId:
          over.previousLocationId !== undefined ? over.previousLocationId : 'loc_hall',
        worldTime: 100,
      },
      branchId: 'main',
      stateShownIds: over.stateShownIds ?? new Set(),
    })
  }
  const moves = (result: ReturnType<typeof run>) =>
    result.actions.filter(
      (a) => a.kind === 'updateEntityInventory' || a.kind === 'updateItemPosition',
    )
  const holdings = (id: string, equipped_items: string[], inventory: string[]) => ({
    kind: 'updateEntityInventory',
    source: 'piggyback_tagged_block',
    payload: { branchId: 'main', id, equipped_items, inventory },
  })
  const position = (id: string, atLocationId: string | null) => ({
    kind: 'updateItemPosition',
    source: 'piggyback_tagged_block',
    payload: { branchId: 'main', id, atLocationId },
  })

  describe('conditions', () => {
    const conditionWrites = (result: ReturnType<typeof run>) =>
      result.actions.filter((a) => a.kind === 'updateEntityCondition')

    it('writes a condition for each place and item the prompt showed with its state', () => {
      const result = run(
        {
          conditions: [
            { id: 'loc_dock', text: 'flooded to the knee' },
            { id: 'item_rope', text: ' frayed through ' },
          ],
        },
        [place('loc_dock'), thing('item_rope')],
        { stateShownIds: new Set(['loc_dock', 'item_rope']) },
      )
      expect(conditionWrites(result)).toEqual([
        {
          kind: 'updateEntityCondition',
          source: 'piggyback_tagged_block',
          payload: { branchId: 'main', id: 'loc_dock', condition: 'flooded to the knee' },
        },
        {
          kind: 'updateEntityCondition',
          source: 'piggyback_tagged_block',
          payload: { branchId: 'main', id: 'item_rope', condition: 'frayed through' },
        },
      ])
      expect(result.applied.conditionsRejected).toEqual([])
    })

    // data-model.md → Authorship contract: seen before written.
    it.each([
      ['the prompt did not show with its state', 'loc_dock', [], 'location', false],
      ['that is no place or item', 'char_1', ['char_1'], 'character', true],
      ['that names no entity', 'loc_gone', ['loc_gone'], null, true],
    ] as const)('refuses a condition for a row %s, logged', (_label, id, shown, kind, wasShown) => {
      const log = spyLogger()
      const result = run(
        { conditions: [{ id, text: 'scorched' }] },
        [place('loc_dock'), person('char_1')],
        { stateShownIds: new Set(shown), log },
      )
      expect(conditionWrites(result)).toEqual([])
      expect(result.applied.conditionsRejected).toEqual([0])
      expect(log.warn).toHaveBeenCalledWith('classifier.condition_unseen', {
        entryId: 'entry_1',
        source: 'piggyback_tagged_block',
        entityId: id,
        kind,
        shown: wasShown,
      })
    })

    it('cuts an over-long condition as it cuts a visual value, logged', () => {
      const log = spyLogger()
      const result = run(
        { conditions: [{ id: 'loc_dock', text: 'word '.repeat(150) }] },
        [place('loc_dock')],
        { stateShownIds: new Set(['loc_dock']), log },
      )
      expect(conditionWrites(result)).toEqual([
        expect.objectContaining({
          payload: {
            branchId: 'main',
            id: 'loc_dock',
            condition: Array.from({ length: 100 }, () => 'word').join(' '),
          },
        }),
      ])
      expect(log.warn).toHaveBeenCalledWith('classifier.condition_truncated', {
        entryId: 'entry_1',
        source: 'piggyback_tagged_block',
        entityId: 'loc_dock',
        length: 749,
        keptLength: 499,
      })
    })

    it('writes no blank condition', () => {
      const result = run({ conditions: [{ id: 'loc_dock', text: '   ' }] }, [place('loc_dock')], {
        stateShownIds: new Set(['loc_dock']),
      })
      expect(conditionWrites(result)).toEqual([])
      expect(result.applied.conditionsRejected).toEqual([0])
    })

    // A refusal is recorded by list position, not id: each repeated id's refused copy comes after
    // its first, so the first index of the id can't pass for the position.
    it('records each refused condition by its position in the block', () => {
      const result = run(
        {
          conditions: [
            { id: 'loc_dock', text: 'flooded to the knee' },
            { id: 'loc_far', text: '  ' },
            { id: 'char_1', text: 'scorched' },
            { id: 'loc_far', text: 'burned out' },
            { id: 'loc_dock', text: '  ' },
          ],
        },
        [place('loc_dock'), place('loc_far'), person('char_1')],
        { stateShownIds: new Set(['loc_dock', 'char_1']) },
      )
      expect(conditionWrites(result)).toEqual([
        expect.objectContaining({
          payload: { branchId: 'main', id: 'loc_dock', condition: 'flooded to the knee' },
        }),
      ])
      expect(result.applied.conditionsRejected).toEqual([1, 2, 3, 4])
    })
  })

  describe('drops', () => {
    it("puts a held item down where the turn's scene is, off every holder", () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({ drops: [{ id: 'item_blade', from: 'char_1', seq: 0 }] }),
        },
        [
          person('char_1', { equipped_items: ['item_blade'] }),
          person('char_2', { inventory: ['item_blade', 'item_key'] }),
          thing('item_blade'),
          place('loc_dock'),
        ],
      )
      expect(moves(result)).toEqual([
        holdings('char_1', [], []),
        holdings('char_2', [], ['item_key']),
        position('item_blade', 'loc_dock'),
      ])
      expect(result.applied.drops).toEqual([{ id: 'item_blade', from: 'char_1', at: 'loc_dock' }])
    })

    it('puts it down at the previous location when the turn names none', () => {
      const result = run({ transfers: transfers({ drops: [{ id: 'item_blade', seq: 0 }] }) }, [
        person('char_1', { equipped_items: ['item_blade'] }),
        thing('item_blade'),
      ])
      expect(moves(result)).toEqual([
        holdings('char_1', [], []),
        position('item_blade', 'loc_hall'),
      ])
      expect(result.applied.drops).toEqual([{ id: 'item_blade', at: 'loc_hall' }])
    })

    it('with no scene location, takes it off its holders and leaves it nowhere, logged', () => {
      const log = spyLogger()
      const result = run(
        { transfers: transfers({ drops: [{ id: 'item_blade', from: 'char_1', seq: 0 }] }) },
        [person('char_1', { equipped_items: ['item_blade'] }), thing('item_blade')],
        { previousLocationId: null, log },
      )
      expect(moves(result)).toEqual([holdings('char_1', [], [])])
      expect(result.applied.drops).toEqual([{ id: 'item_blade', from: 'char_1', at: null }])
      expect(log.warn).toHaveBeenCalledWith('classifier.drop_unplaced', {
        entryId: 'entry_1',
        source: 'piggyback_tagged_block',
        itemId: 'item_blade',
      })
    })

    // piggyback.md → Trailing block format: a drop needs a holder in this turn's scene or the last.
    describe('a holder off the scene', () => {
      const bladeWith = (...holders: string[]) => [
        ...['char_1', 'char_2', 'char_3'].map((id) =>
          person(id, holders.includes(id) ? { inventory: ['item_blade'] } : {}),
        ),
        thing('item_blade'),
        place('loc_dock'),
      ]
      const dropBlade = (sceneEntities: string[]): ParsedStateBlock => ({
        sceneEntities,
        currentLocation: 'loc_dock',
        transfers: transfers({ drops: [{ id: 'item_blade', seq: 0 }] }),
      })

      it('refuses a drop when no holder is in either scene, logged', () => {
        const log = spyLogger()
        const result = run(dropBlade(['char_1']), bladeWith('char_3'), {
          previousScene: ['char_1'],
          log,
        })
        expect(moves(result)).toEqual([])
        expect(result.applied.drops).toEqual([])
        expect(log.warn).toHaveBeenCalledWith('classifier.drop_dropped', {
          entryId: 'entry_1',
          source: 'piggyback_tagged_block',
          itemId: 'item_blade',
          reason: 'off_scene',
          holderIds: ['char_3'],
        })
      })

      it('puts down an item held by someone who left the scene this turn', () => {
        const result = run(dropBlade(['char_1']), bladeWith('char_2'), {
          previousScene: ['char_2'],
        })
        expect(moves(result)).toEqual([
          holdings('char_2', [], []),
          position('item_blade', 'loc_dock'),
        ])
        expect(result.applied.drops).toEqual([{ id: 'item_blade', at: 'loc_dock' }])
      })

      it("puts down an item held by someone in this turn's scene", () => {
        const result = run(dropBlade(['char_2']), bladeWith('char_2'), { previousScene: [] })
        expect(moves(result)).toEqual([
          holdings('char_2', [], []),
          position('item_blade', 'loc_dock'),
        ])
        expect(result.applied.drops).toEqual([{ id: 'item_blade', at: 'loc_dock' }])
      })

      // The holders are whoever has it at the drop's place in the block, not on the stored rows.
      const takeThenDrop = (to: string): ParsedStateBlock => ({
        sceneEntities: ['char_1'],
        currentLocation: 'loc_dock',
        transfers: transfers({
          items: [{ id: 'item_blade', to, slot: 'inventory', seq: 0 }],
          drops: [{ id: 'item_blade', from: to, seq: 1 }],
        }),
      })

      it('puts down an item someone in the scene took from an off-scene holder first', () => {
        const result = run(takeThenDrop('char_1'), bladeWith('char_3'), {
          previousScene: ['char_1'],
        })
        expect(moves(result)).toEqual([
          holdings('char_3', [], []),
          position('item_blade', 'loc_dock'),
        ])
        expect(result.applied.drops).toEqual([{ id: 'item_blade', from: 'char_1', at: 'loc_dock' }])
      })

      it('refuses the drop of an item someone off the scene took from the scene first', () => {
        const result = run(takeThenDrop('char_3'), bladeWith('char_1'), {
          previousScene: ['char_1'],
        })
        expect(moves(result)).toEqual([
          holdings('char_1', [], []),
          holdings('char_3', [], ['item_blade']),
        ])
        expect(result.applied.drops).toEqual([])
      })

      // data-model.md → ItemState shape: an older write can leave an item doubled across holders.
      it('puts down an item doubled across holders when one of them is in the scene', () => {
        const result = run(dropBlade(['char_1']), bladeWith('char_1', 'char_3'), {
          previousScene: ['char_1'],
        })
        expect(moves(result)).toEqual([
          holdings('char_1', [], []),
          holdings('char_3', [], []),
          position('item_blade', 'loc_dock'),
        ])
        expect(result.applied.drops).toEqual([{ id: 'item_blade', at: 'loc_dock' }])
      })
    })

    it('drops a drop for an item nobody holds that lies elsewhere, logged', () => {
      const log = spyLogger()
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({ drops: [{ id: 'item_rope', seq: 0 }] }),
        },
        [person('char_1'), thing('item_rope', 'loc_cellar'), place('loc_dock')],
        { log },
      )
      expect(moves(result)).toEqual([])
      expect(result.applied.drops).toEqual([])
      expect(log.warn).toHaveBeenCalledWith('classifier.drop_dropped', {
        entryId: 'entry_1',
        source: 'piggyback_tagged_block',
        itemId: 'item_rope',
        reason: 'elsewhere',
        atLocationId: 'loc_cellar',
      })
    })

    it('leaves an item already lying where the scene is as it is, logged', () => {
      const log = spyLogger()
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({ drops: [{ id: 'item_rope', seq: 0 }] }),
        },
        [person('char_1'), thing('item_rope', 'loc_dock'), place('loc_dock')],
        { log },
      )
      expect(moves(result)).toEqual([])
      expect(result.applied.drops).toEqual([{ id: 'item_rope', at: 'loc_dock' }])
      expect(log.debug).toHaveBeenCalledWith('classifier.drop_unchanged', {
        entryId: 'entry_1',
        source: 'piggyback_tagged_block',
        itemId: 'item_rope',
        atLocationId: 'loc_dock',
      })
    })

    it('puts down an item that nobody holds and lies nowhere', () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({ drops: [{ id: 'item_rope', seq: 0 }] }),
        },
        [thing('item_rope'), place('loc_dock')],
      )
      expect(moves(result)).toEqual([position('item_rope', 'loc_dock')])
      expect(result.applied.drops).toEqual([{ id: 'item_rope', at: 'loc_dock' }])
    })

    // data-model.md → ItemState shape: a row left doubled by an older write moves on its next drop.
    it('moves an item both held and lying elsewhere to the scene', () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({ drops: [{ id: 'item_rope', seq: 0 }] }),
        },
        [
          person('char_1', { inventory: ['item_rope'] }),
          thing('item_rope', 'loc_cellar'),
          place('loc_dock'),
        ],
      )
      expect(moves(result)).toEqual([holdings('char_1', [], []), position('item_rope', 'loc_dock')])
    })

    // One take and one drop of the same item, from the same rows, in each order.
    const handOff = () => [
      person('char_1'),
      person('char_2', { inventory: ['item_rope'] }),
      thing('item_rope'),
      place('loc_dock'),
    ]

    it('takes, then puts down: the item lies where the scene is', () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({
            items: [{ id: 'item_rope', to: 'char_1', slot: 'inventory', seq: 0 }],
            drops: [{ id: 'item_rope', from: 'char_1', seq: 1 }],
          }),
        },
        handOff(),
      )
      expect(moves(result)).toEqual([holdings('char_2', [], []), position('item_rope', 'loc_dock')])
      expect(result.applied.drops).toEqual([{ id: 'item_rope', from: 'char_1', at: 'loc_dock' }])
    })

    it('puts down, then takes: the item ends held, with no position', () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({
            items: [{ id: 'item_rope', to: 'char_1', slot: 'inventory', seq: 1 }],
            drops: [{ id: 'item_rope', from: 'char_2', seq: 0 }],
          }),
        },
        handOff(),
      )
      expect(moves(result)).toEqual([
        holdings('char_2', [], []),
        holdings('char_1', [], ['item_rope']),
      ])
      expect(result.applied.drops).toEqual([{ id: 'item_rope', from: 'char_2', at: 'loc_dock' }])
    })

    it("lists the drops it applied in the block's order", () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({
            drops: [
              { id: 'item_b', seq: 1 },
              { id: 'item_a', seq: 0 },
            ],
          }),
        },
        [thing('item_a'), thing('item_b'), place('loc_dock')],
      )
      expect(result.applied.drops.map((d) => d.id)).toEqual(['item_a', 'item_b'])
    })

    // A producer can repeat a seq; the tie applies in list order, the take before the drop.
    it('applies a take and a drop sharing a seq as the take, then the drop', () => {
      const result = run(
        {
          currentLocation: 'loc_dock',
          transfers: transfers({
            items: [{ id: 'item_rope', to: 'char_1', slot: 'inventory', seq: 0 }],
            drops: [{ id: 'item_rope', from: 'char_1', seq: 0 }],
          }),
        },
        handOff(),
      )
      expect(moves(result)).toEqual([holdings('char_2', [], []), position('item_rope', 'loc_dock')])
    })
  })
})

// piggyback.md → A bad ref in the two writers: until containers exist only a character holds
// anything, so a transfer's other holder reads by what it names.
describe('buildPiggybackActions — holders read by what they name', () => {
  const characterAt = (id: string, held: Partial<CharacterState>): Entity =>
    mockEntity({
      id,
      state: {
        ...(mockEntity({}).state as CharacterState),
        current_location_id: 'loc_dock',
        ...held,
      },
    })
  const item = (id: string, at: string | null): Entity =>
    mockEntity({ id, kind: 'item', name: id, state: { at_location_id: at } })
  const place = (id: string): Entity =>
    mockEntity({ id, kind: 'location', name: id, state: { parent_location_id: null } })
  const world = (): Entity[] => [
    characterAt('char_mira', {
      equipped_items: ['item_blade'],
      inventory: ['item_pouch'],
      stackables: { gold: 10 },
    }),
    characterAt('char_bob', { inventory: ['item_satchel'], stackables: { gold: 3 } }),
    item('item_blade', null),
    item('item_pouch', null),
    item('item_satchel', null),
    item('item_chest', 'loc_dock'),
    item('item_crate', 'loc_mill'),
    item('item_box', null),
    place('loc_dock'),
    place('loc_mill'),
    mockEntity({ id: 'fac_guild', kind: 'faction', name: 'the Guild', state: {} }),
  ]
  const run = (transfers: Partial<ParsedTransfers>, log: Logger = logger) =>
    buildPiggybackActions({
      log,
      source: 'per_turn_classifier',
      entryId: 'entry_2',
      turn: planned({ transfers: { items: [], stackables: [], drops: [], ...transfers } }),
      entities: world(),
      previousMetadata: {
        sceneEntities: ['char_mira', 'char_bob'],
        currentLocationId: 'loc_dock',
        worldTime: 100,
      },
      branchId: 'main',
    })
  const writes = (result: ReturnType<typeof buildPiggybackActions>, kind: string) =>
    result.actions.flatMap((a) => (a.kind === kind ? [a.payload] : []))
  const blade = (to: string) => ({
    items: [{ id: 'item_blade', from: 'char_mira', to, slot: 'inventory' as const, seq: 0 }],
  })

  it('moves an item into a satchel to whoever holds the satchel', () => {
    const result = run(blade('item_satchel'))
    expect(writes(result, 'updateEntityInventory')).toEqual([
      { branchId: 'main', id: 'char_mira', equipped_items: [], inventory: ['item_pouch'] },
      {
        branchId: 'main',
        id: 'char_bob',
        equipped_items: [],
        inventory: ['item_satchel', 'item_blade'],
      },
    ])
    expect(result.applied.itemsLanded).toBe(1)
  })

  it("moves an item into the giver's own pouch as a change of slot", () => {
    const result = run(blade('item_pouch'))
    expect(writes(result, 'updateEntityInventory')).toEqual([
      {
        branchId: 'main',
        id: 'char_mira',
        equipped_items: [],
        inventory: ['item_pouch', 'item_blade'],
      },
    ])
  })

  it.each([
    ["the scene's place", 'loc_dock'],
    ['a chest lying there', 'item_chest'],
  ])('puts an item moved into %s down there, not as a reported drop', (_label, to) => {
    const result = run(blade(to))
    expect(writes(result, 'updateEntityInventory')).toEqual([
      { branchId: 'main', id: 'char_mira', equipped_items: [], inventory: ['item_pouch'] },
    ])
    expect(writes(result, 'updateItemPosition')).toEqual([
      { branchId: 'main', id: 'item_blade', atLocationId: 'loc_dock' },
    ])
    expect(result.applied.itemsLanded).toBe(1)
    expect(result.applied.drops).toEqual([])
  })

  it.each([
    ['another place', 'loc_mill'],
    ['a crate lying elsewhere', 'item_crate'],
  ])('leaves an item moved into %s where it was', (_label, to) => {
    const result = run(blade(to))
    expect(writes(result, 'updateEntityInventory')).toEqual([])
    expect(writes(result, 'updateItemPosition')).toEqual([])
    expect(result.applied.itemsLanded).toBe(0)
  })

  it('leaves an item moved into a box nobody holds that lies nowhere unplaced', () => {
    const result = run(blade('item_box'))
    expect(writes(result, 'updateEntityInventory')).toEqual([
      { branchId: 'main', id: 'char_mira', equipped_items: [], inventory: ['item_pouch'] },
    ])
    expect(writes(result, 'updateItemPosition')).toEqual([])
    expect(result.applied.itemsLanded).toBe(1)
  })

  it("counts nothing landed for an item moved into the scene's place where it already lies", () => {
    const result = run({
      items: [{ id: 'item_chest', to: 'loc_dock', slot: 'inventory', seq: 0 }],
    })
    expect(writes(result, 'updateEntityInventory')).toEqual([])
    expect(writes(result, 'updateItemPosition')).toEqual([])
    expect(result.applied.itemsLanded).toBe(0)
  })

  it('leaves an item given to a faction unplaced, as given away off-scene', () => {
    const result = run(blade('fac_guild'))
    expect(writes(result, 'updateEntityInventory')).toEqual([
      { branchId: 'main', id: 'char_mira', equipped_items: [], inventory: ['item_pouch'] },
    ])
    expect(writes(result, 'updateItemPosition')).toEqual([])
    expect(result.applied.itemsLanded).toBe(1)
  })

  it.each([
    [
      'from a chest lying here, as found loot',
      { key: 'gold', amount: 5, from: 'item_chest', to: 'char_mira' },
      { char_mira: 15 },
    ],
    [
      'into a chest lying here, as stashed',
      { key: 'gold', amount: 4, from: 'char_mira', to: 'item_chest' },
      { char_mira: 6 },
    ],
    [
      "into Bob's satchel, to Bob",
      { key: 'gold', amount: 2, from: 'char_mira', to: 'item_satchel' },
      { char_mira: 8, char_bob: 5 },
    ],
    [
      "out of Bob's satchel, from Bob",
      { key: 'gold', amount: 1, from: 'item_satchel', to: 'char_mira' },
      { char_mira: 11, char_bob: 2 },
    ],
  ])('moves a stackable %s', (_label, transfer, balances) => {
    const result = run({ stackables: [transfer] })
    expect(
      Object.fromEntries(
        writes(result, 'updateEntityStackables').map((p) => [
          (p as { id: string }).id,
          (p as { stackables: Record<string, number> }).stackables.gold,
        ]),
      ),
    ).toEqual(balances)
  })

  it.each([
    [
      'an item someone holds, as that character',
      blade('item_satchel'),
      { holderId: 'item_satchel', kind: 'item', readAs: 'character', characterId: 'char_bob' },
    ],
    [
      "the scene's place, as here",
      blade('loc_dock'),
      { holderId: 'loc_dock', kind: 'location', readAs: 'here' },
    ],
    [
      'an item lying elsewhere, as elsewhere',
      blade('item_crate'),
      { holderId: 'item_crate', kind: 'item', readAs: 'elsewhere' },
    ],
    [
      'a faction, as omitted',
      blade('fac_guild'),
      { holderId: 'fac_guild', kind: 'faction', readAs: 'omitted' },
    ],
    [
      "a stackable's chest lying here, as here",
      { stackables: [{ key: 'gold', amount: 4, from: 'char_mira', to: 'item_chest' }] },
      { holderId: 'item_chest', kind: 'item', readAs: 'here' },
    ],
  ])('logs a holder read as %s, at debug only', (_label, transfers, reading) => {
    const log = spyLogger()
    run(transfers, log)
    expect(log.debug).toHaveBeenCalledWith('classifier.holder_read', {
      entryId: 'entry_2',
      source: 'per_turn_classifier',
      ...reading,
    })
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  // Bob holds 3 gold and the satchel: the shortfall rule would credit the payee in full.
  it.each([
    ['into his own satchel, past his purse', { from: 'char_bob', to: 'item_satchel', amount: 20 }],
    ['into his own satchel, within his purse', { from: 'char_bob', to: 'item_satchel', amount: 2 }],
    ['to himself by name', { from: 'char_bob', to: 'char_bob', amount: 20 }],
    ['out of his own satchel to himself', { from: 'item_satchel', to: 'char_bob', amount: 20 }],
  ])('changes nothing for a stackable Bob pays %s', (_label, parties) => {
    const log = spyLogger()
    const result = run({ stackables: [{ key: 'gold', ...parties }] }, log)
    expect(writes(result, 'updateEntityStackables')).toEqual([])
    expect(result.applied.stackablesLanded).toBe(0)
    expect(log.warn).not.toHaveBeenCalled()
  })

  // Mira holds 10 gold and no silver; a chest lying here holds no stackable.
  it.each([
    ['gold', 1],
    ['silver', 0],
  ])('counts a stash of %s into a chest as %i landed', (key, landed) => {
    const result = run({ stackables: [{ key, amount: 4, from: 'char_mira', to: 'item_chest' }] })
    expect(result.applied.stackablesLanded).toBe(landed)
  })

  it('logs no reading for a character holder', () => {
    const log = spyLogger()
    run(
      {
        ...blade('char_bob'),
        stackables: [{ key: 'gold', amount: 1, from: 'char_bob', to: 'char_mira' }],
      },
      log,
    )
    expect(log.debug).not.toHaveBeenCalledWith('classifier.holder_read', expect.anything())
  })
})

// principles.md → Injection / retrieval rules: the in-scene invariant seats a disabled row once the
// scene holds it, so the turn records which ones it brought into the narrator's view.
describe('buildPiggybackActions — disabled rows a turn seats', () => {
  const place = (id: string, parent: string | null, mode: Entity['injectionMode'] = 'auto') =>
    mockEntity({
      id,
      kind: 'location',
      name: id,
      injectionMode: mode,
      state: { parent_location_id: parent },
    })
  const world = (): Entity[] => [
    mockEntity({ id: 'char_mira' }),
    mockEntity({ id: 'char_spy', injectionMode: 'disabled' }),
    place('loc_dock', null),
    place('loc_lair', null, 'disabled'),
    place('loc_vault', null, 'disabled'),
    place('loc_cell', 'loc_vault'),
  ]
  const seated = (
    block: ParsedStateBlock,
    previous: { sceneEntities: string[]; currentLocationId: string | null } = {
      sceneEntities: ['char_mira'],
      currentLocationId: 'loc_dock',
    },
  ) =>
    buildPiggybackActions({
      log: logger,
      source: 'per_turn_classifier',
      entryId: 'entry_2',
      turn: planned(block),
      entities: world(),
      previousMetadata: { ...previous, worldTime: 100 },
      branchId: 'main',
    }).applied.seatedDisabled

  it('records a disabled place the scene moves into', () => {
    expect(seated({ sceneEntities: ['char_mira'], currentLocation: 'loc_lair' })).toEqual([
      'loc_lair',
    ])
  })

  it('records a place disabled through its ancestor', () => {
    expect(seated({ sceneEntities: ['char_mira'], currentLocation: 'loc_cell' })).toEqual([
      'loc_cell',
    ])
  })

  it('records a disabled member the scene brings in', () => {
    expect(seated({ sceneEntities: ['char_mira', 'char_spy'] })).toEqual(['char_spy'])
  })

  it('records nothing the scene already held, nor a place around the story', () => {
    expect(
      seated(
        { sceneEntities: ['char_mira', 'char_spy'], currentLocation: 'loc_cell' },
        { sceneEntities: ['char_mira', 'char_spy'], currentLocationId: 'loc_vault' },
      ),
    ).toEqual([])
  })
})
