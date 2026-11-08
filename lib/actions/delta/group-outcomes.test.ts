import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  entities,
  lore,
  stories,
  type CharacterState,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import type { DbCtx, PipelineAction } from '../types'
import {
  applyDeltaAction,
  applyDeltaActionGroup,
  applyDeltaActionGroupWithOutcomes,
} from './apply-delta-action'
import { USER_EDITED_SINCE_PROSE } from './user-precedence'

const BRANCH = 'br_1'

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

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 })
  await db
    .insert(entities)
    .values([
      entity('char_1', 'character'),
      entity('char_staged', 'character', { status: 'staged' }),
      entity('char_retired', 'character', { status: 'retired' }),
      entity('fac_old', 'faction'),
    ])
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: BRANCH,
    title: 'The old road',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  const ctx: DbCtx = { db, runInTransaction }
  return { db, ctx }
}

type Db = Awaited<ReturnType<typeof setup>>['db']

const group = (ctx: DbCtx, actions: readonly PipelineAction[]) =>
  applyDeltaActionGroupWithOutcomes(actions, { actionId: 'act_g', branchId: BRANCH }, ctx)

const deltasOf = (db: Db, actionId: string) =>
  db.select().from(deltas).where(eq(deltas.actionId, actionId))

async function land(ctx: DbCtx, action: PipelineAction, actionId: string): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: BRANCH }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

const restateLore: PipelineAction = {
  kind: 'updateLore',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'lore_1', patch: { title: 'The old road' } },
}

const describeChar1: PipelineAction = {
  kind: 'updateEntity',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'char_1', patch: { description: 'a scarred knight' } },
}

const retire = (id: string): PipelineAction => ({
  kind: 'retireEntity',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id, retiredReason: null, proseEntryId: null },
})

const join = (
  factionId: string,
  proseEntryId: string | null = null,
  source: PipelineAction['source'] = 'periodic_classifier',
): PipelineAction => ({
  kind: 'setCharacterFaction',
  source,
  payload: { branchId: BRANCH, id: 'char_1', factionId, proseEntryId },
})

const create = (row: NewEntity): PipelineAction => ({
  kind: 'createEntity',
  source: 'periodic_classifier',
  payload: { entry: row },
})

const relateTo = (objectId: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, subjectId: 'char_1', objectId, kind: 'ally', proseEntryId: null },
})

const dressChar1: PipelineAction = {
  kind: 'updateEntityVisualState',
  source: 'periodic_classifier',
  payload: { branchId: BRANCH, id: 'char_1', visual: { attire: 'mail' } },
}

const createEntry = (id: string, position: number): PipelineAction => ({
  kind: 'createStoryEntry',
  source: 'ai_classifier',
  payload: {
    entry: { id, branchId: BRANCH, position, kind: 'ai_reply', content: 'prose', createdAt: 1 },
  },
})

describe('applyDeltaActionGroupWithOutcomes (C11)', () => {
  it("reports each action's outcome at its index, with the handler's reason and mark", async () => {
    const { db, ctx } = await setup()

    const result = await group(ctx, [
      restateLore,
      describeChar1,
      retire('char_staged'),
      join('fac_gone'),
    ])

    expect(result).toStrictEqual({
      status: 'ok',
      outcomes: [
        { status: 'noop', reason: 'no-op lore patch', mark: 'restated' },
        { status: 'landed' },
        { status: 'noop', reason: 'not-active' },
        { status: 'noop', reason: 'not-a-faction', mark: 'gone' },
      ],
    })
    const logged = await deltasOf(db, 'act_g')
    expect(logged.map((d) => [d.targetTable, d.targetId])).toEqual([['entities', 'char_1']])
  })

  it('reads landed for a link naming a row created later in the group', async () => {
    const { db, ctx } = await setup()

    // The link sits at index 1 but first in the rerun list, so its outcome must land by index.
    const result = await group(ctx, [
      describeChar1,
      relateTo('char_new'),
      create(entity('char_new', 'character', { name: 'Bram' })),
    ])

    expect(result).toStrictEqual({
      status: 'ok',
      outcomes: [{ status: 'landed' }, { status: 'landed' }, { status: 'landed' }],
    })
    const pairs = await db.select().from(characterRelationships)
    expect(pairs.map((p) => [p.aId, p.bId, p.kind])).toEqual([['char_1', 'char_new', 'ally']])
    expect(await deltasOf(db, 'act_g')).toHaveLength(3)
  })

  it("keeps the rerun's reason for an action that still no-ops on it", async () => {
    const { db, ctx } = await setup()
    await land(ctx, createEntry('e_1', 1), 'act_e1')
    // The user sets the faction after e_1's prose, so a write citing e_1 yields to it.
    await land(ctx, join('fac_old', null, 'user_edit'), 'act_u')

    // Pass one: fac_new is missing ('not-a-faction', gone). The rerun finds it and meets the user.
    const result = await group(ctx, [
      join('fac_new', 'e_1'),
      create(entity('fac_new', 'faction', { name: 'The Circle' })),
    ])

    expect(result).toStrictEqual({
      status: 'ok',
      outcomes: [{ status: 'noop', reason: USER_EDITED_SINCE_PROSE }, { status: 'landed' }],
    })
    const [char1] = await db.select().from(entities).where(eq(entities.id, 'char_1'))
    expect((char1.state as CharacterState).faction_id).toBe('fac_old')
  })

  it('returns every outcome of an all-noop group and writes no delta', async () => {
    const { db, ctx } = await setup()

    const result = await group(ctx, [restateLore, retire('char_retired')])

    expect(result).toStrictEqual({
      status: 'ok',
      outcomes: [
        { status: 'noop', reason: 'no-op lore patch', mark: 'restated' },
        { status: 'noop', reason: 'not-active', mark: 'restated' },
      ],
    })
    expect(await db.select().from(deltas)).toEqual([])
  })

  it('refuses the whole group on a plain refusal and writes nothing', async () => {
    const { db, ctx } = await setup()

    const result = await group(ctx, [
      describeChar1,
      {
        kind: 'updateLore',
        source: 'periodic_classifier',
        payload: { branchId: BRANCH, id: 'lore_gone', patch: { title: 'Gone' } },
      },
    ])

    expect(result).toStrictEqual({
      status: 'rejected',
      reason: 'update target lore br_1:lore_gone not found',
      code: 'not-found',
    })
    expect(await db.select().from(deltas)).toEqual([])
    const [char1] = await db.select().from(entities).where(eq(entities.id, 'char_1'))
    expect(char1.description).toBeNull()
  })

  it('refuses the whole group when a rerun writes a column the group already claimed', async () => {
    const { db, ctx } = await setup()

    // The rerun's faction write lands on char_1's state, which the visual write already claimed.
    const result = await group(ctx, [
      join('fac_new'),
      dressChar1,
      create(entity('fac_new', 'faction', { name: 'The Circle' })),
    ])

    expect(result).toStrictEqual({
      status: 'rejected',
      reason:
        'group writes entities:char_1 twice on one column; every handler read pre-group state',
    })
    expect(await db.select().from(deltas)).toEqual([])
    expect(await db.select().from(entities).where(eq(entities.id, 'fac_new'))).toEqual([])
  })
})

describe('applyDeltaActionGroup', () => {
  it('keeps its shape: ok carries no outcomes', async () => {
    const { ctx } = await setup()

    const result = await applyDeltaActionGroup(
      [restateLore, describeChar1],
      { actionId: 'act_g', branchId: BRANCH },
      ctx,
    )

    expect(result).toStrictEqual({ status: 'ok' })
  })
})
