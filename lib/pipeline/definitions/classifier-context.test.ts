import { describe, expect, it } from 'vitest'

import type { WindowTurn } from '@/lib/classifier'
import type { CharacterRelationship, Entity } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'
import { VARIABLES } from '@/lib/prompts'

import { buildClassifierContext } from './classifier-context'

const turn = (over: Partial<WindowTurn> = {}): WindowTurn => ({
  handle: 't1',
  entryId: 'entry_x',
  position: 1,
  content: 'prose',
  sceneEntities: [],
  currentLocationId: null,
  ...over,
})

describe('buildClassifierContext', () => {
  it('emits exactly the variables pinned for the classifierContext group, nothing more', () => {
    const context = buildClassifierContext({
      window: { turns: [turn()] } as never,
      entities: [],
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    const declared = VARIABLES.classifierContext.map((v) => v.name)
    expect(Object.keys(context).sort()).toEqual(declared.sort())
  })

  // Packs are user-authored, so whatever reaches the context is template surface
  // whether the bundled template renders it or not. Passing the drizzle row whole
  // would silently enrol every future column and make it undroppable.
  it('projects entities to the documented fields, dropping the rest of the row', () => {
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [
        {
          id: 'char_11111111-1111-1111-1111-111111111111',
          branchId: 'b1',
          kind: 'character',
          name: 'Kael',
          description: 'A courier.',
          status: 'active',
          retiredReason: null,
          injectionMode: 'auto',
          nameCollisionFlag: 0,
          nameCollisionPartnerId: null,
          nameCollisionReason: null,
          state: { traits: ['wry'] },
          keywords: [],
          tags: ['secret'],
          embeddingStale: 1,
          createdAt: 1,
          updatedAt: 2,
        } as never,
      ],
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    const [entity] = context.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual(
      ['description', 'faction', 'id', 'keywords', 'kind', 'name', 'status'].sort(),
    )
  })

  it('substitutes entity and happening ids to placeholders but leaves prose alone', () => {
    const idMap = new IdBiMap()
    const context = buildClassifierContext({
      window: {
        turns: [turn({ content: 'Kael char_ prose' })],
      } as never,
      entities: [
        {
          id: 'char_11111111-1111-1111-1111-111111111111',
          name: 'Kael',
          kind: 'character',
          status: 'active',
          description: 'A courier.',
          keywords: [],
        } as never,
      ],
      happenings: [
        { id: 'hap_22222222-2222-2222-2222-222222222222', title: 'The ford ambush' } as never,
      ],
      relationships: [],
      mentionedPlaces: false,
      idMap,
    })
    expect((context.entities as { id: string }[])[0].id).toBe('c1')
    expect((context.happenings as { id: string }[])[0].id).toBe('hp1')
    // Entry ids are NOT substitutable — provenance rides the handle map.
    expect((context.turns as { handle: string }[])[0].handle).toBe('t1')
  })

  it('projects turns down to handle, content, scene and location', () => {
    const context = buildClassifierContext({
      window: { turns: [turn({ position: 7 })] } as never,
      entities: [],
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    // A raw entry id in the prompt would be an id the model can neither use nor
    // resolve, and position is meaningless to it.
    expect(context.turns).toEqual([{ handle: 't1', content: 'prose', scene: [], location: null }])
  })

  const AEFRE = 'char_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const BAEL = 'char_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CORA = 'char_cccccccc-cccc-cccc-cccc-cccccccccccc'
  const DEZ = 'char_dddddddd-dddd-dddd-dddd-dddddddddddd'

  function character(id: string, name: string): Entity {
    return {
      id,
      kind: 'character',
      name,
      description: '',
      status: 'active',
      keywords: [],
    } as unknown as Entity
  }

  function relationship(
    id: string,
    aId: string,
    bId: string,
    kind: string | null,
    inverseKind: string | null,
  ): CharacterRelationship {
    return { id, branchId: 'b1', aId, bId, kind, inverseKind, createdAt: 1, updatedAt: 1 }
  }

  it('emits one fact per non-null perspective, with both names inlined, dropping null views', () => {
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [
        character(AEFRE, 'Aefre'),
        character(BAEL, 'Bael'),
        character(CORA, 'Cora'),
        character(DEZ, 'Dez'),
      ],
      happenings: [],
      relationships: [
        relationship('rel_11111111-1111-1111-1111-111111111111', AEFRE, BAEL, 'sister', null),
        relationship('rel_22222222-2222-2222-2222-222222222222', CORA, DEZ, 'ally', 'rival'),
      ],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    expect(context.relationships).toEqual([
      { subject: 'c1', subjectName: 'Aefre', object: 'c2', objectName: 'Bael', kind: 'sister' },
      { subject: 'c3', subjectName: 'Cora', object: 'c4', objectName: 'Dez', kind: 'ally' },
      { subject: 'c4', subjectName: 'Dez', object: 'c3', objectName: 'Cora', kind: 'rival' },
    ])
  })

  it('drops a relationship row whose character has no entity in the snapshot', () => {
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [character(AEFRE, 'Aefre')],
      happenings: [],
      // BAEL is absent from the snapshot — deleted character, orphan row.
      relationships: [
        relationship('rel_11111111-1111-1111-1111-111111111111', AEFRE, BAEL, 'sister', null),
      ],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    expect(context.relationships).toEqual([])
  })

  describe('saved scene', () => {
    const FORD = 'loc_eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const GONE = 'char_99999999-9999-9999-9999-999999999999'
    const GONE_LOC = 'loc_99999999-9999-9999-9999-999999999999'
    const location = (id: string, name: string) =>
      ({
        id,
        kind: 'location',
        name,
        description: null,
        status: 'active',
        keywords: [],
      }) as unknown as Entity

    // Entities walk first, so a scene listing BAEL before AEFRE still numbers the
    // roster in roster order.
    it("substitutes each turn's scene and location to the roster's and the tree's placeholders", () => {
      const context = buildClassifierContext({
        window: {
          turns: [turn({ sceneEntities: [BAEL, AEFRE], currentLocationId: FORD })],
        } as never,
        entities: [character(AEFRE, 'Aefre'), character(BAEL, 'Bael'), location(FORD, 'The ford')],
        happenings: [],
        relationships: [],
        mentionedPlaces: false,
        idMap: new IdBiMap(),
      })
      expect((context.entities as { id: string }[]).map((e) => e.id)).toEqual(['c1', 'c2'])
      expect((context.places as { id: string }[]).map((e) => e.id)).toEqual(['l1'])
      expect(context.turns).toEqual([
        { handle: 't1', content: 'prose', scene: ['c2', 'c1'], location: 'l1' },
      ])
    })

    it('leaves out a scene or location id the branch no longer has, unallocated', () => {
      const idMap = new IdBiMap()
      const context = buildClassifierContext({
        window: {
          turns: [turn({ sceneEntities: [AEFRE, GONE], currentLocationId: GONE_LOC })],
        } as never,
        entities: [character(AEFRE, 'Aefre')],
        happenings: [],
        relationships: [],
        mentionedPlaces: false,
        idMap,
      })
      expect(context.turns).toEqual([
        { handle: 't1', content: 'prose', scene: ['c1'], location: null },
      ])
      expect(idMap.getPlaceholderFor(GONE)).toBeUndefined()
      expect(idMap.getPlaceholderFor(GONE_LOC)).toBeUndefined()
    })
  })

  it("carries each entity's stored keywords", () => {
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [{ ...character(AEFRE, 'Aefre'), keywords: ['the Grey Wolf'] } as Entity],
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    })
    expect((context.entities as { keywords: string[] }[])[0].keywords).toEqual(['the Grey Wolf'])
  })

  // classifier.md → Mentioned places: places leave Known entities for a tree that hides nothing.
  describe('places', () => {
    const KEEP = 'loc_11111111-1111-1111-1111-111111111111'
    const HALL = 'loc_22222222-2222-2222-2222-222222222222'
    const CRYPT = 'loc_33333333-3333-3333-3333-333333333333'
    const MARSH = 'loc_44444444-4444-4444-4444-444444444444'
    const place = (id: string, name: string, parent: string | null, over: Partial<Entity> = {}) =>
      ({
        id,
        kind: 'location',
        name,
        description: `${name}, described.`,
        status: 'active',
        retiredReason: null,
        injectionMode: 'auto',
        keywords: [],
        state: { parent_location_id: parent },
        createdAt: 1,
        ...over,
      }) as unknown as Entity

    const build = (entities: Entity[], idMap = new IdBiMap(), mentionedPlaces = false) =>
      buildClassifierContext({
        window: { turns: [] } as never,
        entities,
        happenings: [],
        relationships: [],
        mentionedPlaces,
        idMap,
      })

    it('lists every place as a tree, by name under its parent, whatever its status or mode', () => {
      const context = build([
        character(AEFRE, 'Aefre'),
        place(CRYPT, 'The Crypt', KEEP, {
          status: 'retired',
          retiredReason: 'sealed\n  by the abbot',
        }),
        place(HALL, 'Great Hall', KEEP, { status: 'staged', keywords: ['the hall'] }),
        place(KEEP, 'Ashen Keep', null, { injectionMode: 'disabled' }),
        place(MARSH, 'The Marsh', null, { description: 'Reeds.\n\nAnd   black water. ' }),
      ])
      expect(context.entities).toEqual([expect.objectContaining({ id: 'c1', kind: 'character' })])
      expect(context.places).toEqual([
        {
          id: 'l1',
          name: 'Ashen Keep',
          depth: 0,
          status: 'active',
          retiredReason: null,
          description: 'Ashen Keep, described.',
          keywords: [],
        },
        {
          id: 'l2',
          name: 'Great Hall',
          depth: 1,
          status: 'staged',
          retiredReason: null,
          description: 'Great Hall, described.',
          keywords: ['the hall'],
        },
        {
          id: 'l3',
          name: 'The Crypt',
          depth: 1,
          status: 'retired',
          retiredReason: 'sealed by the abbot',
          description: 'The Crypt, described.',
          keywords: [],
        },
        {
          id: 'l4',
          name: 'The Marsh',
          depth: 0,
          status: 'active',
          retiredReason: null,
          description: 'Reeds. And black water.',
          keywords: [],
        },
      ])
    })

    it('puts a multi-line name or keyword on one line', () => {
      const context = build([
        place(HALL, 'Great\n  Hall', null, { keywords: ['the\nhall', 'the  great\r\nroom'] }),
      ])
      expect(context.places).toEqual([
        expect.objectContaining({ name: 'Great Hall', keywords: ['the hall', 'the great room'] }),
      ])
    })

    // Un-retiring a place keeps its stored reason.
    it.each(['active', 'staged'] as const)(
      'shows no retired reason for a place now %s',
      (status) => {
        const context = build([
          place(HALL, 'Great Hall', null, { status, retiredReason: 'burned' }),
        ])
        expect(context.places).toEqual([expect.objectContaining({ status, retiredReason: null })])
      },
    )

    // The Keep sorts first in the tree, so the Hall the scene names first is still l2.
    it('a scene names a place by its Places-tree placeholder', () => {
      const idMap = new IdBiMap()
      const context = buildClassifierContext({
        window: {
          turns: [turn({ sceneEntities: [HALL, AEFRE], currentLocationId: HALL })],
        } as never,
        entities: [
          place(HALL, 'Great Hall', null),
          place(KEEP, 'Ashen Keep', null),
          character(AEFRE, 'Aefre'),
        ],
        happenings: [],
        relationships: [],
        mentionedPlaces: false,
        idMap,
      })
      expect(idMap.getPlaceholderFor(HALL)).toBe('l2')
      expect(context.turns).toEqual([
        { handle: 't1', content: 'prose', scene: ['l2', 'c1'], location: 'l2' },
      ])
    })

    it('carries the setting the pass read', () => {
      expect(build([], new IdBiMap(), true).mentionedPlaces).toBe(true)
      expect(build([]).mentionedPlaces).toBe(false)
    })
  })
})

// classifier.md → Factions → What the pass sees.
describe('buildClassifierContext — factions', () => {
  const KAEL = 'char_11111111-1111-1111-1111-111111111111'
  const ARIA = 'char_22222222-2222-2222-2222-222222222222'
  const CIRCLE = 'fact_33333333-3333-3333-3333-333333333333'
  const GONE = 'fact_44444444-4444-4444-4444-444444444444'

  const row = (id: string, kind: Entity['kind'], name: string, state: unknown = null) =>
    ({
      id,
      kind,
      name,
      description: null,
      status: 'active',
      keywords: [],
      state,
    }) as unknown as Entity

  const contextOf = (entities: Entity[], idMap = new IdBiMap()) =>
    buildClassifierContext({
      window: { turns: [] } as never,
      entities,
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap,
    }).entities as { id: string; faction: string | null }[]

  it("gives a character its faction's placeholder, a faction's prefix even when first met there", () => {
    const entities = contextOf([
      row(KAEL, 'character', 'Kael', { faction_id: CIRCLE }),
      row(CIRCLE, 'faction', 'The Iron Circle'),
    ])
    expect(entities).toEqual([
      expect.objectContaining({ id: 'c1', faction: 'f1' }),
      expect.objectContaining({ id: 'f1', faction: null }),
    ])
  })

  it('leaves out a faction id that names no listed faction', () => {
    const idMap = new IdBiMap()
    const entities = contextOf(
      [
        row(KAEL, 'character', 'Kael', { faction_id: GONE }),
        row(ARIA, 'character', 'Aria', { faction_id: KAEL }),
      ],
      idMap,
    )
    expect(entities.map((e) => e.faction)).toEqual([null, null])
    // Substituted, it would still reach the prompt: as a placeholder no line lists.
    expect(idMap.getPlaceholderFor(GONE)).toBeUndefined()
  })

  it('collapses each entity onto one line', () => {
    const [entity] = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [
        {
          ...row(KAEL, 'character', 'Kael\nthe  Grey'),
          description: 'A courier.\n\nHunted.',
          keywords: ['the\nwolf'],
        } as Entity,
      ],
      happenings: [],
      relationships: [],
      mentionedPlaces: false,
      idMap: new IdBiMap(),
    }).entities as Record<string, unknown>[]
    expect(entity).toMatchObject({
      name: 'Kael the Grey',
      description: 'A courier. Hunted.',
      keywords: ['the wolf'],
    })
  })
})
