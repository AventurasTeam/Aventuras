import { describe, expect, it } from 'vitest'

import { IdBiMap } from '@/lib/ids'
import { VARIABLES } from '@/lib/prompts'

import { buildClassifierContext } from './classifier-context'

describe('buildClassifierContext', () => {
  it('emits exactly the variables pinned for the classifierContext group, nothing more', () => {
    const context = buildClassifierContext({
      window: { turns: [{ handle: 't1', entryId: 'e1', position: 1, content: 'prose' }] } as never,
      entities: [],
      happenings: [],
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
          state: { traits: ['wry'] },
          tags: ['secret'],
          embeddingStale: 1,
          createdAt: 1,
          updatedAt: 2,
        } as never,
      ],
      happenings: [],
      idMap: new IdBiMap(),
    })
    const [entity] = context.entities as Record<string, unknown>[]
    expect(Object.keys(entity).sort()).toEqual(
      ['description', 'id', 'kind', 'name', 'status'].sort(),
    )
  })

  it('substitutes entity and happening ids to placeholders but leaves prose alone', () => {
    const idMap = new IdBiMap()
    const context = buildClassifierContext({
      window: {
        turns: [{ handle: 't1', entryId: 'entry_x', position: 1, content: 'Kael char_ prose' }],
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
      idMap,
    })
    expect((context.entities as { id: string }[])[0].id).toBe('c1')
    expect((context.happenings as { id: string }[])[0].id).toBe('hp1')
    // Entry ids are NOT substitutable — provenance rides the handle map.
    expect((context.turns as { handle: string }[])[0].handle).toBe('t1')
  })

  it('projects turns down to handle and content only', () => {
    const context = buildClassifierContext({
      window: {
        turns: [{ handle: 't1', entryId: 'entry_x', position: 7, content: 'prose' }],
      } as never,
      entities: [],
      happenings: [],
      idMap: new IdBiMap(),
    })
    // A raw entry id in the prompt would be an id the model can neither use nor
    // resolve, and position is meaningless to it.
    expect(context.turns).toEqual([{ handle: 't1', content: 'prose' }])
  })
})
