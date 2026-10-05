import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  storyEntries,
  translations,
  type Delta,
  type EntryMetadata,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generationStore } from '@/lib/stores'
import { entityDeleteActions } from '@/lib/world'

import { applyDeltaActionGroup } from './apply-delta-action'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const entity = (id: string, kind: NewEntity['kind'] = 'character', extra = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind,
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

beforeEach(async () => {
  generationStore.__reset()
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: 'char_lead' } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db
    .insert(entities)
    .values([entity('char_lead'), entity('char_keep'), entity('char_lose')])
  await ctx.db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
  await ctx.db
    .insert(happeningAwareness)
    .values({ id: 'haw_lose', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_lose' })
})

const group = (actions: PipelineAction[]) =>
  applyDeltaActionGroup(actions, { actionId: 'act_g', branchId: 'b1' }, ctx)

const deleteEntity = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
})

async function snapshot() {
  return {
    entities: await ctx.db.select().from(entities),
    awareness: await ctx.db.select().from(happeningAwareness),
    involvements: await ctx.db.select().from(happeningInvolvements),
    relationships: await ctx.db.select().from(characterRelationships),
    happenings: await ctx.db.select().from(happenings),
    deltas: await ctx.db.select().from(deltas),
  }
}

async function undoGroup(): Promise<void> {
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, 'act_g'))
    .orderBy(desc(deltas.logPosition))) as Delta[]
  await reverseAndPruneDeltaRows(
    await selectReversalSet(ctx, { branchId: 'b1', target: rows }),
    ctx,
  )
}

describe('applyDeltaActionGroup — a delete and a write naming what it removes', () => {
  it('rejects a merge-shaped group that explicitly deletes a link the entity delete cascades', async () => {
    const before = await snapshot()

    const result = await group([
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: 'b1', happeningId: 'hap_1', characterId: 'char_keep' },
      },
      {
        kind: 'deleteHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'haw_lose' },
      },
      deleteEntity('char_lose'),
    ])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
  })

  it('rejects a link create naming an entity the group deletes', async () => {
    const before = await snapshot()

    const result = await group([
      {
        kind: 'createHappeningInvolvement',
        source: 'user_edit',
        payload: {
          entry: { id: 'hinv_new', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_lose' },
        },
      },
      deleteEntity('char_lose'),
    ])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
  })

  it('rejects a link create naming a happening the group deletes', async () => {
    const before = await snapshot()

    const result = await group([
      {
        kind: 'deleteHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1' },
      },
      {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: { branchId: 'b1', happeningId: 'hap_1', characterId: 'char_keep' },
      },
    ])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
  })

  it('rejects a translation create naming a happening the group deletes', async () => {
    const before = await snapshot()

    const result = await group([
      {
        kind: 'deleteHappening',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'hap_1' },
      },
      {
        kind: 'createTranslation',
        source: 'user_edit',
        payload: {
          entry: {
            id: 'tr_new',
            branchId: 'b1',
            targetKind: 'happening',
            targetId: 'hap_1',
            field: 'title',
            language: 'es',
            translatedText: 'Fuego',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    ])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
    expect(await ctx.db.select().from(translations)).toEqual([])
  })

  it('rejects a translation create naming a relationship the group cascades', async () => {
    await ctx.db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'b1',
      aId: 'char_keep',
      bId: 'char_lose',
      kind: 'ally',
      createdAt: 1,
      updatedAt: 1,
    })
    const before = await snapshot()

    const result = await group([
      deleteEntity('char_lose'),
      {
        kind: 'createTranslation',
        source: 'user_edit',
        payload: {
          entry: {
            id: 'tr_new',
            branchId: 'b1',
            targetKind: 'character_relationship',
            targetId: 'rel_1',
            field: 'kind',
            language: 'es',
            translatedText: 'aliado',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    ])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
    expect(await ctx.db.select().from(translations)).toEqual([])
  })

  it('rejects two deletes whose cascades both take one link row', async () => {
    await ctx.db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'b1',
      aId: 'char_keep',
      bId: 'char_lose',
      kind: 'ally',
      createdAt: 1,
      updatedAt: 1,
    })
    const before = await snapshot()

    const result = await group([deleteEntity('char_keep'), deleteEntity('char_lose')])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
  })

  // Without cascade children the cascade check never fires, and two logged deletes of one
  // row make every later undo re-insert it twice.
  it('rejects two deletes of one childless row', async () => {
    const before = await snapshot()

    const result = await group([deleteEntity('char_keep'), deleteEntity('char_keep')])

    expect(result).toMatchObject({ status: 'rejected', code: 'group-conflict' })
    expect(await snapshot()).toEqual(before)
    expect(before.deltas).toEqual([])
  })

  it('commits the entity delete builder output and undoes it cleanly', async () => {
    await ctx.db.insert(entities).values([
      entity('fac_1', 'faction'),
      entity('char_member', 'character', {
        state: { ...emptyEntityState('character'), faction_id: 'fac_1' },
      }),
    ])
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_f', branchId: 'b1', happeningId: 'hap_1', entityId: 'fac_1' })
    await ctx.db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'Once.',
      metadata: {
        sceneEntities: ['fac_1', 'char_keep'],
        currentLocationId: null,
        worldTime: 0,
      } as EntryMetadata,
      createdAt: 1,
    })
    const branchEntities = await ctx.db.select().from(entities)
    const { actions } = entityDeleteActions({
      branchId: 'b1',
      target: branchEntities.find((row) => row.id === 'fac_1')!,
      branchEntities,
      tail: { id: 'entry_1', sceneEntities: ['fac_1', 'char_keep'], currentLocationId: null },
    })
    expect(actions.map((action) => action.kind)).toEqual([
      'updateEntity',
      'updateStoryEntryMetadata',
      'deleteEntity',
    ])

    expect(await group(actions)).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
    await undoGroup()

    const ids = (await ctx.db.select({ id: entities.id }).from(entities)).map((row) => row.id)
    expect(ids).toContain('fac_1')
    const inv = await ctx.db.select({ id: happeningInvolvements.id }).from(happeningInvolvements)
    expect(inv).toEqual([{ id: 'hinv_f' }])
  })

  it('commits a create-with-links Save naming rows the group creates or keeps', async () => {
    const result = await group([
      {
        kind: 'createHappening',
        source: 'user_edit',
        payload: {
          entry: { id: 'hap_new', branchId: 'b1', title: 'Flood', createdAt: 2, updatedAt: 2 },
        },
      },
      {
        kind: 'createHappeningInvolvement',
        source: 'user_edit',
        payload: {
          entry: { id: 'hinv_new', branchId: 'b1', happeningId: 'hap_new', entityId: 'char_keep' },
        },
      },
    ])

    expect(result).toEqual({ status: 'ok' })
    expect(
      await ctx.db
        .select({ id: happeningInvolvements.id })
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.happeningId, 'hap_new')),
    ).toEqual([{ id: 'hinv_new' }])
  })
})
