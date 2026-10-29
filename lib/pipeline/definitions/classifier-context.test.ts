import { describe, expect, it } from 'vitest'

import type { WindowTurn } from '@/lib/classifier'
import type { CharacterRelationship, Entity, Thread } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'
import { renderTemplate, TEMPLATE_IDS, VARIABLES } from '@/lib/prompts'

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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
      idMap: new IdBiMap(),
    })
    const [entity] = context.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual(
      ['description', 'faction', 'id', 'keywords', 'kind', 'name', 'standing', 'status'].sort(),
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
      idMap,
    })
    expect((context.entities as { id: string }[])[0].id).toBe('c1')
    expect((context.happenings as { id: string }[])[0].id).toBe('hp1')
    // Entry ids are NOT substitutable — provenance rides the handle map.
    expect((context.turns as { handle: string }[])[0].handle).toBe('t1')
  })

  // classifier.md → What the classifier reads: the lead by the placeholder its own line holds.
  it.each([
    ['a listed character', 'char_22222222-2222-2222-2222-222222222222', { id: 'c2', name: 'Aria' }],
    ['a faction', 'fact_33333333-3333-3333-3333-333333333333', null],
    ['no row', 'char_99999999-9999-9999-9999-999999999999', null],
    ['nothing', null, null],
  ])('names the lead as its line does when it is %s', (_label, leadId, lead) => {
    const row = (id: string, name: string, kind: string) =>
      ({ id, name, kind, status: 'active', description: null, keywords: [] }) as never
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [
        row('char_11111111-1111-1111-1111-111111111111', 'Kael', 'character'),
        row('char_22222222-2222-2222-2222-222222222222', 'Aria\n the Bold', 'character'),
        row('fact_33333333-3333-3333-3333-333333333333', 'The Wardens', 'faction'),
      ],
      happenings: [],
      relationships: [],
      threads: [],
      mentionedPlaces: false,
      leadId,
      idMap: new IdBiMap(),
    })
    expect(context.lead).toEqual(lead == null ? null : { ...lead, name: 'Aria the Bold' })
    expect((context.entities as { id: string }[]).map((e) => e.id)).toEqual(['c1', 'c2', 'f1'])
  })

  it('projects turns down to handle, content, scene and location', () => {
    const context = buildClassifierContext({
      window: { turns: [turn({ position: 7 })] } as never,
      entities: [],
      happenings: [],
      relationships: [],
      threads: [],
      mentionedPlaces: false,
      leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
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
        threads: [],
        mentionedPlaces: false,
        leadId: null,
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
        threads: [],
        mentionedPlaces: false,
        leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
      idMap: new IdBiMap(),
    })
    expect((context.entities as { keywords: string[] }[])[0].keywords).toEqual(['the Grey Wolf'])
  })

  // The line already shows the name, so "(also called: …)" leaves out a keyword equal to it under
  // keyword-term normalization; a keyword that only contains the name still shows.
  describe("a row's own name among its keywords", () => {
    const KEEP = 'loc_11111111-1111-1111-1111-111111111111'
    const build = (entities: Entity[]) =>
      buildClassifierContext({
        window: { turns: [] } as never,
        entities,
        happenings: [],
        relationships: [],
        threads: [],
        mentionedPlaces: false,
        leadId: null,
        idMap: new IdBiMap(),
      })
    const kael = {
      ...character(AEFRE, 'Kael'),
      keywords: [' KAEL ', "Kael's sister", 'the Grey Wolf'],
    } as Entity
    const keep = {
      ...character(KEEP, 'Ashen Keep'),
      kind: 'location',
      state: { parent_location_id: null },
      keywords: ['ashen keep'],
    } as Entity

    it('stays on the row and leaves the rendered line', () => {
      const context = build([kael, keep])
      expect((context.entities as { keywords: string[] }[])[0].keywords).toEqual([
        "Kael's sister",
        'the Grey Wolf',
      ])
      expect(kael.keywords).toEqual([' KAEL ', "Kael's sister", 'the Grey Wolf'])
      const { user } = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
      expect(user).toContain(
        "- [c1] Kael (character) (also called: Kael's sister, the Grey Wolf)\n",
      )
      // A place whose only keyword is its name loses the parenthetical, as with none at all.
      expect(user).toContain('- [l1] Ashen Keep\n')
      expect(keep.keywords).toEqual(['ashen keep'])
    })
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
        threads: [],
        mentionedPlaces,
        leadId: null,
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

    // classifier.md → What the classifier reads: the unplaced places in a group of their own.
    it('lists the unplaced places, each with what lies inside it, apart from the tree', () => {
      const VARN = 'loc_55555555-5555-5555-5555-555555555555'
      const DOCKS = 'loc_66666666-6666-6666-6666-666666666666'
      const context = build([
        place(DOCKS, 'Varn Docks', VARN),
        place(VARN, 'Varn', null, {
          state: { parent_location_id: null, unplaced: true },
          keywords: ['the ford town'],
        }),
        place(KEEP, 'Ashen Keep', null),
        place(MARSH, 'The Marsh', 'loc_gone'),
      ])
      expect(context.places).toEqual([expect.objectContaining({ id: 'l1', name: 'Ashen Keep' })])
      // Numbered after the tree: substituteIds allocates in walk order.
      expect(context.placesUnplaced).toEqual([
        expect.objectContaining({ id: 'l2', name: 'The Marsh', depth: 0 }),
        {
          id: 'l3',
          name: 'Varn',
          depth: 0,
          status: 'active',
          retiredReason: null,
          description: 'Varn, described.',
          keywords: ['the ford town'],
        },
        expect.objectContaining({ id: 'l4', name: 'Varn Docks', depth: 1 }),
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
        threads: [],
        mentionedPlaces: false,
        leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
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
      threads: [],
      mentionedPlaces: false,
      leadId: null,
      idMap: new IdBiMap(),
    }).entities as Record<string, unknown>[]
    expect(entity).toMatchObject({
      name: 'Kael the Grey',
      description: 'A courier. Hunted.',
      keywords: ['the wolf'],
    })
  })
})

// classifier.md → Factions → What the pass sees: each faction with its standing.
describe('buildClassifierContext — standing', () => {
  const CIRCLE = 'fact_33333333-3333-3333-3333-333333333333'
  const KAEL = 'char_11111111-1111-1111-1111-111111111111'
  const row = (id: string, kind: Entity['kind'], state: unknown) =>
    ({
      id,
      kind,
      name: id,
      description: null,
      status: 'active',
      keywords: [],
      state,
    }) as unknown as Entity
  const standingOf = (entity: Entity) =>
    (
      buildClassifierContext({
        window: { turns: [] } as never,
        entities: [entity],
        happenings: [],
        relationships: [],
        threads: [],
        mentionedPlaces: false,
        leadId: null,
        idMap: new IdBiMap(),
      }).entities as { standing: string | null }[]
    )[0].standing

  it("carries a faction's standing on one line", () => {
    expect(standingOf(row(CIRCLE, 'faction', { standing: 'at war\n  with the crown' }))).toBe(
      'at war with the crown',
    )
  })

  it.each([
    ['a blank standing', row(CIRCLE, 'faction', { standing: '  ' })],
    ['no standing', row(CIRCLE, 'faction', { agenda: [] })],
    ['a null state', row(CIRCLE, 'faction', null)],
    ['another kind, whatever its state holds', row(KAEL, 'character', { standing: 'leaked' })],
  ])('carries none for %s', (_label, entity) => {
    expect(standingOf(entity)).toBeNull()
  })
})

// classifier.md → Threads → What the pass sees: every thread by id, title and status.
describe('buildClassifierContext — threads', () => {
  const RELIC = 'thr_11111111-1111-1111-1111-111111111111'
  const HEIR = 'thr_22222222-2222-2222-2222-222222222222'
  const thread = (id: string, title: string, over: Partial<Thread> = {}): Thread => ({
    id,
    branchId: 'b1',
    title,
    description: 'Long prose the pass never reads.',
    category: 'quest',
    icon: 'key',
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

  it("lists every thread by placeholder, title and status, the user's included", () => {
    const idMap = new IdBiMap()
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [],
      happenings: [],
      relationships: [],
      threads: [
        thread(RELIC, 'Recover\n  the relic', {
          triggeredAtEntryId: 'entry_1',
          resolvedAtEntryId: 'entry_2',
          status: 'resolved',
        }),
        thread(HEIR, 'Find the heir', { status: 'pending' }),
      ],
      mentionedPlaces: false,
      leadId: null,
      idMap,
    })
    // No entry refs: entry_* is not substitutable, so they would reach the prompt raw.
    expect(context.threads).toEqual([
      { id: 'th1', title: 'Recover the relic', status: 'resolved' },
      { id: 'th2', title: 'Find the heir', status: 'pending' },
    ])
    expect(idMap.getUuidFor('th2')).toBe(HEIR)
  })
})

describe('buildClassifierContext — happenings', () => {
  it('lists each happening by placeholder and title, the title on one line', () => {
    const context = buildClassifierContext({
      window: { turns: [] } as never,
      entities: [],
      happenings: [
        { id: 'hap_11111111-1111-1111-1111-111111111111', title: 'The ford\n  ambush ' } as never,
      ],
      relationships: [],
      threads: [],
      mentionedPlaces: false,
      leadId: null,
      idMap: new IdBiMap(),
    })
    expect(context.happenings).toEqual([{ id: 'hp1', title: 'The ford ambush' }])
  })
})
