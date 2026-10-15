import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CharacterState, Delta, Entity, NewEntity } from '@/lib/db'
import { branches, characterRelationships, deltas, entities, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { ID_PATTERN } from '@/lib/ids'
import type { readSceneSource as ReadSceneSource } from '@/lib/pipeline'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  resetAllStores,
} from '@/lib/stores'
import { characterDraftFrom, locationDraftFrom } from '@/lib/world'

import { saveEntity } from './save-entity'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { registerEntities } from '../entities/register'
import { registerCharacterRelationships } from '../relationships/register'
import type { loadHeadTurn as LoadHeadTurn } from '../story-entries/head-turn'

// Runs `onCall` before each `loadHeadTurn` read; the second is the tail lock's in-lock re-read.
const headTurnHook = vi.hoisted(() => ({
  calls: 0,
  onCall: null as ((call: number) => Promise<void>) | null,
}))
vi.mock('../story-entries/head-turn', async (importOriginal) => {
  const real = (await importOriginal()) as { loadHeadTurn: typeof LoadHeadTurn }
  return {
    ...real,
    loadHeadTurn: async (...args: Parameters<typeof LoadHeadTurn>) => {
      headTurnHook.calls += 1
      await headTurnHook.onCall?.(headTurnHook.calls)
      return real.loadHeadTurn(...args)
    },
  }
})

const sceneHook = vi.hoisted(() => ({ fail: null as Error | null }))
vi.mock('@/lib/pipeline', async (importOriginal) => {
  const real = (await importOriginal()) as { readSceneSource: typeof ReadSceneSource }
  return {
    ...real,
    readSceneSource: async (...args: Parameters<typeof ReadSceneSource>) => {
      if (sceneHook.fail) throw sceneHook.fail
      return real.readSceneSource(...args)
    },
  }
})

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
  headTurnHook.calls = 0
  headTurnHook.onCall = null
  sceneHook.fail = null
})

describe('saveEntity', () => {
  it('logs a Save whose actions fail to build, and rethrows', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values(loc('loc_keep', null))
    const row = await rowOf(db, 'loc_keep')
    const error = vi.spyOn(logger, 'error')
    await expect(
      saveEntity(
        {
          kind: 'character',
          branchId: 'br_1',
          row,
          keywordsBase: row.keywords,
          draft: characterDraftFrom(null, []),
          relationships: [],
          relationshipsBase: [],
        },
        ctx,
      ),
    ).rejects.toThrow('location row saved as character')
    expect(error).toHaveBeenCalledWith(
      'action_layer.entity_save_failed',
      expect.objectContaining({ id: 'loc_keep', error: expect.stringContaining('saved as') }),
    )
  })

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
      await saveEntity(
        {
          kind: 'character',
          branchId: 'br_1',
          row,
          keywordsBase: row.keywords,
          draft,
          relationships: [],
          relationshipsBase: [],
        },
        ctx,
      ),
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
        keywordsBase: [],
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
        keywordsBase: row.keywords,
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
      relationships: [
        {
          cardKey: 'card_aria',
          otherId: 'char_aria',
          selfToOther: 'sister',
          otherToSelf: 'brother',
        },
      ],
    }
    await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row,
        keywordsBase: row.keywords,
        draft,
        relationships: [],
        relationshipsBase: [],
      },
      ctx,
    )
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
      relationships: [
        { cardKey: 'card_aria', otherId: 'char_aria', selfToOther: '', otherToSelf: 'rival' },
      ],
    }
    await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row,
        keywordsBase: row.keywords,
        draft,
        relationships: [],
        relationshipsBase: [],
      },
      ctx,
    )
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
        keywordsBase: [],
        draft: {
          ...characterDraftFrom(null, []),
          name: 'Sable',
          relationships: [
            { cardKey: 'card_aria', otherId: 'char_aria', selfToOther: 'debtor', otherToSelf: '' },
          ],
        },
        relationships: [],
        relationshipsBase: [],
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

  it('keeps a pair added after the draft baseline while it writes the edited one', async () => {
    const { db, ctx } = await setup()
    await db
      .insert(entities)
      .values([
        character('char_aria', 'Aria'),
        character('char_kael', 'Kael'),
        character('char_vorne', 'Vorne'),
      ])
    const rel = { branchId: 'br_1', createdAt: 1, updatedAt: 1 }
    await db.insert(characterRelationships).values([
      {
        ...rel,
        id: 'rel_aria',
        aId: 'char_aria',
        bId: 'char_kael',
        kind: 'brother',
        inverseKind: 'sister',
      },
      {
        ...rel,
        id: 'rel_vorne',
        aId: 'char_kael',
        bId: 'char_vorne',
        kind: 'rival',
        inverseKind: null,
      },
    ])
    characterRelationshipsStore.hydrate('br_1', await db.select().from(characterRelationships))
    const current = characterRelationshipsStore.getRelationships('char_kael', 'br_1')
    const base = current.filter((r) => r.otherId === 'char_aria')
    expect(base).toHaveLength(1)
    expect(current).toHaveLength(2)

    const row = await rowOf(db, 'char_kael')
    const draft = {
      ...characterDraftFrom(row, base),
      relationships: [
        {
          cardKey: 'card_aria',
          otherId: 'char_aria',
          selfToOther: 'estranged sister',
          otherToSelf: 'brother',
        },
      ],
    }
    expect(
      await saveEntity(
        {
          kind: 'character',
          branchId: 'br_1',
          row,
          keywordsBase: row.keywords,
          draft,
          relationships: current,
          relationshipsBase: base,
        },
        ctx,
      ),
    ).toEqual({ status: 'ok', id: 'char_kael' })

    const rels = await db.select().from(characterRelationships)
    expect(rels.find((r) => r.id === 'rel_vorne')).toMatchObject({
      kind: 'rival',
      inverseKind: null,
    })
    // Kael is b of Kael↔Aria, so Kael's view of Aria is inverse_kind.
    expect(rels.find((r) => r.id === 'rel_aria')).toMatchObject({
      kind: 'brother',
      inverseKind: 'estranged sister',
    })
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'update', targetId: 'rel_aria' })
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
        keywordsBase: row.keywords,
        draft: { ...characterDraftFrom(row, []), keywords: ['Grey Wolf', 'grey wolf'] },
        relationships: [],
        relationshipsBase: [],
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
        keywordsBase: row.keywords,
        draft: { ...characterDraftFrom(row, []), description: 'x' },
        relationships: [],
        relationshipsBase: [],
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

// data-model.md → LocationState shape: the World Save's place rules, against the real delta log.
describe('saveEntity — places', () => {
  const place = (id: string, parent: string | null, extra: Partial<NewEntity> = {}): NewEntity => ({
    ...loc(id, parent),
    name:
      {
        loc_eldra: 'Eldra',
        loc_vellis: 'Port Vellis',
        loc_anchor: 'The Rusty Anchor',
        loc_back: 'the back room',
      }[id] ?? id,
    ...extra,
  })

  // The rows in both the DB and the store a Save reads, plus a tail whose scene is at `storyAt`.
  async function seed(rows: NewEntity[], storyAt: string | null) {
    const { db, ctx } = await setup()
    await db.insert(entities).values(rows)
    const stored = (await db.select().from(entities)) as Entity[]
    entitiesStore.hydrate('br_1', stored)
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'Once.',
      metadata: { sceneEntities: [], currentLocationId: storyAt, worldTime: 0 },
      createdAt: 1,
    })
    return { db, ctx }
  }

  const locationSave = async (
    db: Db,
    id: string,
    changes: Partial<ReturnType<typeof locationDraftFrom>>,
  ) => {
    const row = await rowOf(db, id)
    return {
      kind: 'location' as const,
      branchId: 'br_1',
      row,
      keywordsBase: row.keywords,
      draft: { ...locationDraftFrom(row), ...changes },
    }
  }

  const REGION = [
    place('loc_eldra', null),
    place('loc_vellis', 'loc_eldra'),
    place('loc_anchor', 'loc_vellis'),
    place('loc_back', 'loc_anchor'),
  ]

  it('retires a place and every place inside in one action, and one undo restores them all', async () => {
    const { db, ctx } = await seed(REGION, 'loc_eldra')
    const result = await saveEntity(
      await locationSave(db, 'loc_vellis', { status: 'retired', retiredReason: 'sank' }),
      ctx,
    )
    expect(result).toEqual({ status: 'ok', id: 'loc_vellis' })
    const rows = await deltaRows(db)
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
    expect(rows.map((r) => r.targetId).sort()).toEqual(['loc_anchor', 'loc_back', 'loc_vellis'])
    for (const id of ['loc_vellis', 'loc_anchor', 'loc_back'])
      expect(await rowOf(db, id)).toMatchObject({ status: 'retired', retiredReason: 'sank' })

    expect(await reverseReplayDeltas(rows[0].actionId, ctx)).toBe(3)
    for (const id of ['loc_vellis', 'loc_anchor', 'loc_back'])
      expect(await rowOf(db, id)).toMatchObject({ status: 'active', retiredReason: null })
  })

  it('refuses retiring a place the story is inside, naming both, and writes nothing', async () => {
    const { db, ctx } = await seed(REGION, 'loc_back')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const result = await saveEntity(
      await locationSave(db, 'loc_vellis', { status: 'retired' }),
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'story-inside',
      refusal: {
        code: 'story-inside',
        field: 'status',
        place: { id: 'loc_vellis', name: 'Port Vellis' },
        story: { id: 'loc_back', name: 'the back room' },
      },
    })
    expect(await deltaRows(db)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('action_layer.entity_save_rejected', {
      branchId: 'br_1',
      id: 'loc_vellis',
      create: false,
      code: 'story-inside',
    })
  })

  // A user_action standing at the tail after a refused unwind, its scene rewritten by a merge: the
  // reply before it still names the deleted loser, and the next turn inherits the tail's place.
  it("refuses retiring the tail's place while the scene source names a deleted one", async () => {
    const { db, ctx } = await seed(REGION, 'loc_gone')
    await db.insert(storyEntries).values({
      id: 'entry_2',
      branchId: 'br_1',
      position: 2,
      kind: 'user_action',
      content: 'I wait.',
      metadata: { sceneEntities: [], currentLocationId: 'loc_anchor', worldTime: 0 },
      createdAt: 2,
    })
    const result = await saveEntity(
      await locationSave(db, 'loc_vellis', { status: 'retired' }),
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'story-inside',
      refusal: { field: 'status', story: { id: 'loc_anchor', name: 'The Rusty Anchor' } },
    })
    expect(await deltaRows(db)).toHaveLength(0)
  })

  // The same scene the next turn's prompt reads.
  it('reads the story from the latest narrative entry, past actions with no scene', async () => {
    const { db, ctx } = await seed(REGION, 'loc_back')
    await db.insert(storyEntries).values(
      [2, 3].map((position) => ({
        id: `entry_${position}`,
        branchId: 'br_1',
        position,
        kind: 'user_action' as const,
        content: 'I wait.',
        metadata: null,
        createdAt: position,
      })),
    )
    const result = await saveEntity(
      await locationSave(db, 'loc_vellis', { injectionMode: 'disabled' }),
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'story-inside',
      refusal: { field: 'injectionMode' },
    })
  })

  it('refuses in-flight, logged, when the story moves into the place while it takes the tail lock', async () => {
    const { db, ctx } = await seed(REGION, 'loc_eldra')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    headTurnHook.onCall = async (call) => {
      if (call !== 2) return
      await db.insert(storyEntries).values({
        id: 'entry_2',
        branchId: 'br_1',
        position: 2,
        kind: 'ai_reply',
        content: 'Inside.',
        metadata: { sceneEntities: [], currentLocationId: 'loc_back', worldTime: 0 },
        createdAt: 2,
      })
    }
    const result = await saveEntity(
      await locationSave(db, 'loc_vellis', { status: 'retired' }),
      ctx,
    )
    expect(result).toEqual({ status: 'rejected', reason: 'tail moved', code: 'in-flight' })
    expect(await deltaRows(db)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('action_layer.entity_save_rejected', {
      branchId: 'br_1',
      id: 'loc_vellis',
      kind: 'location',
      code: 'in-flight',
      reason: 'tail moved',
    })
  })

  it('logs a read under the tail lock that throws, and rethrows', async () => {
    const { db, ctx } = await seed(REGION, 'loc_eldra')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    headTurnHook.onCall = async () => {
      throw new Error('SQLITE_BUSY')
    }
    await expect(
      saveEntity(await locationSave(db, 'loc_vellis', { status: 'retired' }), ctx),
    ).rejects.toThrow('SQLITE_BUSY')
    expect(error).toHaveBeenCalledWith('action_layer.entity_save_failed', {
      branchId: 'br_1',
      id: 'loc_vellis',
      kind: 'location',
      error: 'SQLITE_BUSY',
    })
  })

  it('logs a scene read that throws, and rethrows', async () => {
    const { db, ctx } = await seed(REGION, 'loc_eldra')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    sceneHook.fail = new Error('SQLITE_BUSY')
    await expect(
      saveEntity(await locationSave(db, 'loc_vellis', { status: 'retired' }), ctx),
    ).rejects.toThrow('SQLITE_BUSY')
    expect(error).toHaveBeenCalledWith('action_layer.entity_save_failed', {
      branchId: 'br_1',
      id: 'loc_vellis',
      kind: 'location',
      error: 'SQLITE_BUSY',
    })
  })

  it('logs a location Save whose actions fail to build once, and rethrows', async () => {
    const { db, ctx } = await seed([...REGION, character('char_kael', 'Kael')], 'loc_eldra')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const row = await rowOf(db, 'char_kael')
    await expect(
      saveEntity(
        {
          kind: 'location',
          branchId: 'br_1',
          row,
          keywordsBase: [],
          draft: locationDraftFrom(null),
        },
        ctx,
      ),
    ).rejects.toThrow('character row saved as location')
    expect(error).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith(
      'action_layer.entity_save_failed',
      expect.objectContaining({ id: 'char_kael' }),
    )
  })

  it('refuses bringing back a place whose parent is retired', async () => {
    const { db, ctx } = await seed(
      [
        place('loc_eldra', null),
        place('loc_vellis', 'loc_eldra', { status: 'retired' }),
        place('loc_anchor', 'loc_vellis', { status: 'retired' }),
      ],
      'loc_eldra',
    )
    const result = await saveEntity(await locationSave(db, 'loc_anchor', { status: 'active' }), ctx)
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'retired-parent',
      refusal: { field: 'status', parent: { id: 'loc_vellis', name: 'Port Vellis' } },
    })
    expect(await deltaRows(db)).toHaveLength(0)
  })

  it("refuses moving a character into a retired place, and saves one that's already there", async () => {
    const { db, ctx } = await seed(
      [
        place('loc_vellis', null, { status: 'retired' }),
        character('char_kael', 'Kael'),
        character('char_mira', 'Mira', {
          state: {
            ...(character('x', 'x').state as CharacterState),
            current_location_id: 'loc_vellis',
          },
        }),
      ],
      null,
    )
    const kael = await rowOf(db, 'char_kael')
    const moved = await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row: kael,
        keywordsBase: [],
        draft: { ...characterDraftFrom(kael, []), currentLocationId: 'loc_vellis' },
        relationships: [],
        relationshipsBase: [],
      },
      ctx,
    )
    expect(moved).toMatchObject({
      status: 'rejected',
      code: 'retired-place',
      refusal: { field: 'currentLocationId' },
    })
    const mira = await rowOf(db, 'char_mira')
    const stays = await saveEntity(
      {
        kind: 'character',
        branchId: 'br_1',
        row: mira,
        keywordsBase: [],
        draft: { ...characterDraftFrom(mira, []), description: 'waits' },
        relationships: [],
        relationshipsBase: [],
      },
      ctx,
    )
    expect(stays).toEqual({ status: 'ok', id: 'char_mira' })
  })
})
