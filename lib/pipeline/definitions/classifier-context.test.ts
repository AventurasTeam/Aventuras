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
          tags: ['secret'],
          embeddingStale: 1,
          createdAt: 1,
          updatedAt: 2,
        } as never,
      ],
      happenings: [],
      relationships: [],
      idMap: new IdBiMap(),
    })
    const [entity] = context.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual(
      ['description', 'id', 'keywords', 'kind', 'name', 'status'].sort(),
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
        } as never,
      ],
      happenings: [
        { id: 'hap_22222222-2222-2222-2222-222222222222', title: 'The ford ambush' } as never,
      ],
      relationships: [],
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
    return { id, kind: 'character', name, description: '', status: 'active' } as unknown as Entity
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
      idMap: new IdBiMap(),
    })
    expect(context.relationships).toEqual([])
  })

  describe('saved scene', () => {
    const FORD = 'loc_eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const GONE = 'char_99999999-9999-9999-9999-999999999999'
    const GONE_LOC = 'loc_99999999-9999-9999-9999-999999999999'
    const location = (id: string, name: string) =>
      ({ id, kind: 'location', name, description: null, status: 'active' }) as unknown as Entity

    // Entities walk first, so a scene listing BAEL before AEFRE still numbers the
    // roster in roster order.
    it("substitutes each turn's scene and location to the roster's placeholders", () => {
      const context = buildClassifierContext({
        window: {
          turns: [turn({ sceneEntities: [BAEL, AEFRE], currentLocationId: FORD })],
        } as never,
        entities: [character(AEFRE, 'Aefre'), character(BAEL, 'Bael'), location(FORD, 'The ford')],
        happenings: [],
        relationships: [],
        idMap: new IdBiMap(),
      })
      expect((context.entities as { id: string }[]).map((e) => e.id)).toEqual(['c1', 'c2', 'l1'])
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
      idMap: new IdBiMap(),
    })
    expect((context.entities as { keywords: string[] }[])[0].keywords).toEqual(['the Grey Wolf'])
  })
})
