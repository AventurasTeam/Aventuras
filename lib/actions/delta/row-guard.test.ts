import { describe, expect, it } from 'vitest'

import { branches, emptyEntityState, entities, lore, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import type { DbCtx, GuardRow, PipelineAction } from '../types'
import { applyDeltaAction } from './apply-delta-action'
import { readRowGuard } from './row-guard'

const BRANCH = 'br_1'

const CHAR_STATE = { ...emptyEntityState('character'), traits: ['brave'] }

const entity = (
  id: string,
  kind: NewEntity['kind'],
  fields: Partial<NewEntity> = {},
): NewEntity => ({
  id,
  branchId: BRANCH,
  kind,
  name: id,
  status: 'active',
  injectionMode: 'auto',
  state: emptyEntityState(kind),
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

async function setup(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 })
  await db
    .insert(entities)
    .values([entity('char_1', 'character', { state: CHAR_STATE }), entity('loc_1', 'location')])
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: BRANCH,
    title: 'The old road',
    body: 'A road.',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  return { db, runInTransaction }
}

async function land(
  ctx: DbCtx,
  action: PipelineAction,
  actionId: string,
  entryId: string | null = null,
): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: BRANCH, entryId }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

const createEntry = (id: string, position: number): PipelineAction => ({
  kind: 'createStoryEntry',
  source: 'ai_classifier',
  payload: {
    entry: { id, branchId: BRANCH, position, kind: 'ai_reply', content: 'prose', createdAt: 1 },
  },
})

/** e_1 and e_2 are the chapter (E = e_2); e_3 is a later turn, its action `act_t3`. */
async function turns(ctx: DbCtx): Promise<void> {
  await land(ctx, createEntry('e_1', 1), 'act_t1')
  await land(ctx, createEntry('e_2', 2), 'act_t2')
  await land(ctx, createEntry('e_3', 3), 'act_t3')
}

const updateEntity = (
  source: PipelineAction['source'],
  id: string,
  patch: Record<string, unknown>,
): PipelineAction => ({ kind: 'updateEntity', source, payload: { branchId: BRANCH, id, patch } })

const updateLore = (
  source: PipelineAction['source'],
  patch: Record<string, unknown>,
): PipelineAction => ({
  kind: 'updateLore',
  source,
  payload: { branchId: BRANCH, id: 'lore_1', patch, proseEntryId: null },
})

const ROWS: readonly GuardRow[] = [
  { table: 'entities', id: 'char_1' },
  { table: 'entities', id: 'loc_1' },
  { table: 'entities', id: 'char_new' },
  { table: 'lore', id: 'lore_1' },
]

const guard = (ctx: DbCtx, proseEntryId = 'e_1', rows: readonly GuardRow[] = ROWS) =>
  readRowGuard({ branchId: BRANCH, endEntryId: 'e_2', proseEntryId, rows }, ctx)

describe('readRowGuard', () => {
  it('reads a user edit of traits as writing traits alone, not voice', async () => {
    const ctx = await setup()
    await turns(ctx)
    await land(
      ctx,
      updateEntity('user_edit', 'char_1', {
        state: { ...CHAR_STATE, traits: ['brave', 'stubborn'] },
      }),
      'act_u',
    )

    const row = (await guard(ctx)).row('entities', 'char_1')
    expect(row.userWrote('state', ['traits'])).toBe(true)
    expect(row.userWrote('state', ['voice'])).toBe(false)
    expect(row.userWrote('description')).toBe(false)
    expect(row.userTouched()).toBe(true)
    expect(row.laterTurnTouched()).toBe(false)
  })

  it("counts only user edits after the cited turn's prose", async () => {
    const ctx = await setup()
    await land(ctx, createEntry('e_1', 1), 'act_t1')
    await land(ctx, updateEntity('user_edit', 'char_1', { description: 'a knight' }), 'act_u')
    await land(ctx, createEntry('e_2', 2), 'act_t2')

    expect((await guard(ctx, 'e_2')).row('entities', 'char_1').userWrote('description')).toBe(false)
    expect((await guard(ctx, 'e_1')).row('entities', 'char_1').userWrote('description')).toBe(true)
  })

  it("reads a later turn's write by field", async () => {
    const ctx = await setup()
    await turns(ctx)
    await land(
      ctx,
      updateEntity('per_turn_classifier', 'char_1', {
        description: 'scarred',
        state: { ...CHAR_STATE, traits: ['brave', 'scarred'] },
      }),
      'act_t3',
    )

    const rowGuard = await guard(ctx)
    const row = rowGuard.row('entities', 'char_1')
    expect(row.laterTurnWrote('description')).toBe(true)
    expect(row.laterTurnWrote('state', ['traits'])).toBe(true)
    expect(row.laterTurnWrote('state', ['voice'])).toBe(false)
    expect(row.laterTurnTouched()).toBe(true)
    expect(row.userWrote('description')).toBe(false)
    expect(row.userTouched()).toBe(false)
    const untouched = rowGuard.row('entities', 'loc_1')
    expect(untouched.laterTurnWrote('description')).toBe(false)
    expect(untouched.laterTurnTouched()).toBe(false)
  })

  it('reads a row a later turn created as written whole', async () => {
    const ctx = await setup()
    await turns(ctx)
    await land(
      ctx,
      {
        kind: 'createEntity',
        source: 'per_turn_classifier',
        payload: { entry: entity('char_new', 'character', { name: 'Bram' }) },
      },
      'act_t3',
    )

    const row = (await guard(ctx)).row('entities', 'char_new')
    expect(row.laterTurnWrote('description')).toBe(true)
    expect(row.laterTurnWrote('state', ['voice'])).toBe(true)
    expect(row.laterTurnTouched()).toBe(true)
  })

  it('reads a lore row', async () => {
    const ctx = await setup()
    await turns(ctx)
    await land(
      ctx,
      updateLore('periodic_classifier', { body: 'A drowned road.' }),
      'act_pass',
      'e_3',
    )
    await land(ctx, updateLore('user_edit', { title: 'The drowned road' }), 'act_u')

    const row = (await guard(ctx)).row('lore', 'lore_1')
    expect(row.laterTurnWrote('body')).toBe(true)
    expect(row.laterTurnWrote('title')).toBe(false)
    expect(row.userWrote('title')).toBe(true)
    expect(row.userWrote('body')).toBe(false)
  })

  it("reads a place's parent through the placement group", async () => {
    const ctx = await setup()
    await turns(ctx)
    await land(
      ctx,
      updateEntity('user_edit', 'loc_1', { state: { parent_location_id: null, unplaced: true } }),
      'act_u',
    )

    const row = (await guard(ctx)).row('entities', 'loc_1')
    expect(row.userWrote('state', ['parent_location_id'])).toBe(true)
    expect(row.userWrote('state', ['condition'])).toBe(false)
  })

  it('throws for a row it was not given', async () => {
    const ctx = await setup()
    await turns(ctx)
    const rowGuard = await guard(ctx, 'e_1', [{ table: 'entities', id: 'char_1' }])
    expect(() => rowGuard.row('entities', 'loc_1')).toThrow('entities:loc_1')
  })
})
