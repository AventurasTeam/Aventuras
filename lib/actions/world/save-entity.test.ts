import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CharacterState, Delta, Entity, NewEntity } from '@/lib/db'
import { branches, characterRelationships, deltas, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { ID_PATTERN } from '@/lib/ids'
import { generationStore, resetAllStores } from '@/lib/stores'
import { characterDraftFrom, locationDraftFrom } from '@/lib/world'

import { saveEntity } from './save-entity'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { registerEntities } from '../entities/register'
import { registerCharacterRelationships } from '../relationships/register'

async function setup() {
  __resetRegistry()
  registerEntities()
  registerCharacterRelationships()
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, ctx: { db, runInTransaction } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']

const character = (id: string, name: string, extra: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: 'br_1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  state: {
    visual: { hair: 'dark' },
    traits: [],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: { entryId: 'e_1', locationId: null, worldTime: 10 },
  },
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

const loc = (id: string, parent: string | null): NewEntity => ({
  id,
  branchId: 'br_1',
  kind: 'location',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: { parent_location_id: parent },
  createdAt: 1,
  updatedAt: 1,
})

async function rowOf(db: Db, id: string): Promise<Entity> {
  const [row] = (await db.select().from(entities).where(eq(entities.id, id))) as Entity[]
  return row
}

async function deltaRows(db: Db): Promise<Delta[]> {
  return (await db.select().from(deltas).where(eq(deltas.branchId, 'br_1'))) as Delta[]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveEntity', () => {
  it('writes description, visual.hair and a tag as one delta whose undo holds exactly those three', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values(character('char_kael', 'Kael', { description: 'A courier.', tags: ['courier'] }))
    const row = await rowOf(db, 'char_kael')
    const draft = {
      ...characterDraftFrom(row, []),
      description: 'A courier turned fugitive.',
      visualHair: 'dark, rain-soaked',
      tags: ['courier', 'fugitive'],
    }

    expect(
      await saveEntity({ kind: 'character', branchId: 'br_1', row, draft, relationships: [] }, ctx),
    ).toEqual({ status: 'ok', id: 'char_kael' })

    const rows = await deltaRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'update', targetTable: 'entities', source: 'user_edit' })
    expect(rows[0].undoPayload).toEqual({
      description: 'A courier.',
      tags: ['courier'],
      state: { visual: { hair: 'dark' } },
    })

    const saved = await rowOf(db, 'char_kael')
    expect(saved.description).toBe('A courier turned fugitive.')
    expect(saved.tags).toEqual(['courier', 'fugitive'])
    expect((saved.state as CharacterState).visual.hair).toBe('dark, rain-soaked')

    expect(await reverseReplayDeltas(rows[0].actionId, ctx)).toBe(1)
    const restored = await rowOf(db, 'char_kael')
    expect(restored.description).toBe('A courier.')
    expect(restored.tags).toEqual(['courier'])
    expect(restored.state).toEqual(row.state)
  })

  it('creates a location with a generated id and an empty location state', async () => {
    const { db, ctx } = await setup()
    const result = await saveEntity(
      {
        kind: 'location',
        branchId: 'br_1',
        row: null,
        draft: { ...locationDraftFrom(null), name: 'The Salt Wells' },
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.id).toMatch(ID_PATTERN)
    expect(result.id.startsWith('loc_')).toBe(true)
    expect((await rowOf(db, result.id)).state).toEqual({ parent_location_id: null })
  })

  it('surfaces the handler parent-cycle refusal by code and writes nothing', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([loc('loc_a', null), loc('loc_b', 'loc_a')])
    const row = await rowOf(db, 'loc_a')
    const result = await saveEntity(
      {
        kind: 'location',
        branchId: 'br_1',
        row,
        draft: { ...locationDraftFrom(row), parentLocationId: 'loc_b' },
      },
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'parent-cycle',
      code: 'parent-cycle',
    })
    expect(await deltaRows(db)).toHaveLength(0)
  })

  it('saves a relationship with both views as one action and one ordered row', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([character('char_aria', 'Aria'), character('char_kael', 'Kael')])
    const row = await rowOf(db, 'char_kael')
    const draft = {
      ...characterDraftFrom(row, []),
      relationships: [{ otherId: 'char_aria', selfToOther: 'sister', otherToSelf: 'brother' }],
    }
    await saveEntity({ kind: 'character', branchId: 'br_1', row, draft, relationships: [] }, ctx)
    const rels = await db.select().from(characterRelationships)
    expect(rels).toHaveLength(1)
    expect(rels[0]).toMatchObject({
      aId: 'char_aria',
      bId: 'char_kael',
      kind: 'brother',
      inverseKind: 'sister',
    })
    // One delta: the relationship write. The untouched entity row adds no updateEntity.
    expect(await deltaRows(db)).toHaveLength(1)
  })

  it('saves a relationship from their view alone', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([character('char_aria', 'Aria'), character('char_kael', 'Kael')])
    const row = await rowOf(db, 'char_kael')
    const draft = {
      ...characterDraftFrom(row, []),
      relationships: [{ otherId: 'char_aria', selfToOther: '', otherToSelf: 'rival' }],
    }
    await saveEntity({ kind: 'character', branchId: 'br_1', row, draft, relationships: [] }, ctx)
    // Kael is b: Aria's view of Kael lands in `kind` (a's view of b).
    expect((await db.select().from(characterRelationships))[0]).toMatchObject({
      kind: 'rival',
      inverseKind: null,
    })
  })

  it('creates an entity and its relationship in one action, id pre-generated for the write', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(character('char_aria', 'Aria'))
    const result = await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row: null,
        draft: {
          ...characterDraftFrom(null, []),
          name: 'Sable',
          relationships: [{ otherId: 'char_aria', selfToOther: 'debtor', otherToSelf: '' }],
        },
        relationships: [],
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.id).toMatch(ID_PATTERN)
    expect(result.id.startsWith('char_')).toBe(true)

    const entityRows = await db.select().from(entities)
    expect(entityRows).toHaveLength(2)
    expect(entityRows.find((e) => e.name === 'Sable')?.id).toBe(result.id)

    // Canonical a_id < b_id order decides which column holds Sable's debtor view.
    const sableIsA = result.id < 'char_aria'
    const rels = await db.select().from(characterRelationships)
    expect(rels).toHaveLength(1)
    expect(rels[0]).toMatchObject({
      aId: sableIsA ? result.id : 'char_aria',
      bId: sableIsA ? 'char_aria' : result.id,
      kind: sableIsA ? 'debtor' : null,
      inverseKind: sableIsA ? null : 'debtor',
    })

    const rows = await deltaRows(db)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
  })

  it('collapses keyword case variants on commit', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(character('char_kael', 'Kael'))
    const row = await rowOf(db, 'char_kael')
    await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row,
        draft: { ...characterDraftFrom(row, []), keywords: ['Grey Wolf', 'grey wolf'] },
        relationships: [],
      },
      ctx,
    )
    expect((await rowOf(db, 'char_kael')).keywords).toEqual(['Grey Wolf'])
  })

  it('refuses while generation is in flight', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(character('char_kael', 'Kael'))
    const row = await rowOf(db, 'char_kael')
    vi.spyOn(generationStore, 'isUserEditBlocked').mockReturnValue(true)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const result = await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row,
        draft: { ...characterDraftFrom(row, []), description: 'x' },
        relationships: [],
      },
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'in-flight' })
    expect(await deltaRows(db)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('action_layer.entity_save_rejected', {
      branchId: 'br_1',
      id: 'char_kael',
      code: 'in-flight',
    })
  })
})
