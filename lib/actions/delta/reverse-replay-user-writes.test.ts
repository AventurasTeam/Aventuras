import { and, desc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  stories,
  type CharacterState,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { characterRelationshipsStore, entitiesStore, entriesStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import {
  buildReverseAndPrunePlan,
  reverseAndPruneDeltaRows,
  reverseReplayDeltas,
} from './reverse-replay'
import { USER_EDITED_SINCE_PROSE } from './user-precedence'
import { updateStoryEntryContent } from '../story-entries/operational'
import type { PipelineAction } from '../types'

afterEach(() => {
  entitiesStore.__reset()
  characterRelationshipsStore.__reset()
  entriesStore.__reset()
})

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  entitiesStore.hydrate('b1', [])
  characterRelationshipsStore.hydrate('b1', [])
  return { db, ctx: { db, runInTransaction } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']
type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

async function apply(ctx: Ctx, action: PipelineAction, actionId: string, entryId?: string) {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1', entryId }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltasOf(db: Db, actionId: string): Promise<Delta[]> {
  return (await db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

async function actionIds(db: Db): Promise<string[]> {
  const rows = await db.select({ actionId: deltas.actionId }).from(deltas)
  return rows.map((r) => r.actionId).sort()
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  keywords: ['the knight'],
  createdAt: 1,
  updatedAt: 1,
}

async function kael(db: Db) {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'char_kael')))
  return row
}

const createKael = (ctx: Ctx, over: Partial<NewEntity> = {}) =>
  apply(
    ctx,
    { kind: 'createEntity', source: 'user_edit', payload: { entry: { ...KAEL, ...over } } },
    'act_0',
  )

const userPatch = (patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id: 'char_kael', patch },
})

const promote: PipelineAction = {
  kind: 'promoteStagedEntity',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', id: 'char_kael' },
}

const retire: PipelineAction = {
  kind: 'retireEntity',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', id: 'char_kael', retiredReason: 'fell' },
}

const append = (keywords: string[]): PipelineAction => ({
  kind: 'appendEntityKeywords',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', id: 'char_kael', keywords },
})

// char_kael < char_mira, so the row's `kind` is Kael's view and `inverseKind` Mira's.
const classifyView = (kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', subjectId: 'char_kael', objectId: 'char_mira', kind },
})

const classifyMiraView = (kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', subjectId: 'char_mira', objectId: 'char_kael', kind },
})

const userViews = (kaelView: string | null, miraView: string | null): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: {
    branchId: 'b1',
    subjectId: 'char_kael',
    objectId: 'char_mira',
    kind: kaelView,
    inverseKind: miraView,
  },
})

async function pair(db: Db) {
  return db
    .select()
    .from(characterRelationships)
    .where(
      and(
        eq(characterRelationships.branchId, 'b1'),
        eq(characterRelationships.aId, 'char_kael'),
        eq(characterRelationships.bId, 'char_mira'),
      ),
    )
}

// cadence.md → User edits and classifier writes: reversing a machine write keeps any
// column the user wrote after it.
describe('reversing a machine write under a later user write', () => {
  // Not a retire then a revive: the retire's undo restores `active`, the revive's own
  // value, so that case passes with or without the rule.
  it('keeps a status the user set after the promotion, and prunes only the promotion', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx, { status: 'staged' })
    await apply(ctx, promote, 'act_c')
    await apply(ctx, userPatch({ status: 'retired', retiredReason: 'exiled' }), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await kael(db)).toMatchObject({ status: 'retired', retiredReason: 'exiled' })
    expect(entitiesStore.getById('char_kael')).toMatchObject({ status: 'retired' })
    expect(await actionIds(db)).toEqual(['act_0', 'act_u'])
  })

  it('keeps the keyword list the user saved after the append', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, append(['the wanderer']), 'act_c')
    await apply(ctx, userPatch({ keywords: ['the knight', 'the wanderer', 'ser kael'] }), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect((await kael(db)).keywords).toEqual(['the knight', 'the wanderer', 'ser kael'])
    expect(await actionIds(db)).toEqual(['act_0', 'act_u'])
  })

  it('keeps a view the user set after the classifier changed it', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('friend', 'friend'), 'act_0')
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(ctx, userViews('rival', 'friend'), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    const [row] = await pair(db)
    expect(row).toMatchObject({ kind: 'rival', inverseKind: 'friend' })
    expect(characterRelationshipsStore.getById(row.id)).toEqual(row)
  })

  it('still reverses the columns of its own the user did not write since', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, retire, 'act_c')
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await kael(db)).toMatchObject({ status: 'active', retiredReason: null })
  })

  it('still reverses a column the later user edit left alone', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, retire, 'act_c')
    await apply(ctx, userPatch({ description: 'a knight errant' }), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await kael(db)).toMatchObject({
      status: 'active',
      retiredReason: null,
      description: 'a knight errant',
    })
  })

  it('restores as before when the user edit is reversed alongside', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('friend', 'friend'), 'act_0')
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(ctx, userViews('rival', 'friend'), 'act_u')

    const rows = [...(await deltasOf(db, 'act_u')), ...(await deltasOf(db, 'act_c'))]
    await reverseAndPruneDeltaRows(rows, ctx)

    expect((await pair(db))[0].kind).toBe('friend')
  })

  it('weighs each machine write against the user edits after it alone', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('friend', 'friend'), 'act_0')
    await apply(ctx, classifyView('ally'), 'act_c1')
    await apply(ctx, userViews('rival', 'friend'), 'act_u')
    await apply(ctx, classifyView('enemy'), 'act_c2')

    const rows = [...(await deltasOf(db, 'act_c2')), ...(await deltasOf(db, 'act_c1'))]
    await reverseAndPruneDeltaRows(rows, ctx)

    expect((await pair(db))[0].kind).toBe('rival')
  })

  it('is not held back by a later machine write', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('friend', 'friend'), 'act_0')
    await apply(ctx, classifyView('ally'), 'act_c1')
    await apply(ctx, classifyView('enemy'), 'act_c2')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c1'), ctx)

    expect((await pair(db))[0].kind).toBe('friend')
  })

  it('restores the state sub-fields it changed under a user edit of another one', async () => {
    const { db, ctx } = await setup()
    const state: CharacterState = {
      visual: { attire: 'travel cloak' },
      traits: ['brave'],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      stackables: {},
      faction_id: null,
      lastSeenAt: null,
    }
    await createKael(ctx, { state })
    const armor: PipelineAction = {
      kind: 'updateEntityVisualState',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_kael', visual: { attire: 'plate armor' } },
    }
    await apply(ctx, armor, 'act_c')
    const edited = { ...state, visual: { attire: 'plate armor' }, traits: ['brave', 'stubborn'] }
    await apply(ctx, userPatch({ state: edited }), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect((await kael(db)).state).toMatchObject({
      visual: { attire: 'travel cloak' },
      traits: ['brave', 'stubborn'],
    })
  })

  it("reverses a user delta over the user's own later write, as CTRL-Z always has", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, userPatch({ status: 'retired' }), 'act_u1')
    await apply(ctx, userPatch({ status: 'staged' }), 'act_u2')

    await reverseReplayDeltas('act_u1', ctx)

    expect((await kael(db)).status).toBe('active')
  })
})

describe('reversing a machine view update', () => {
  it('deletes a pair the reversal would leave with no view', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('ally', null), 'act_0')
    const [created] = await pair(db)
    await apply(ctx, classifyMiraView('wary'), 'act_c')
    await apply(ctx, userViews(null, 'wary'), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await pair(db)).toHaveLength(0)
    expect(characterRelationshipsStore.getById(created.id)).toBeUndefined()
    expect(await actionIds(db)).toEqual(['act_0', 'act_u'])
  })

  // The classifier never clears a view today, but the upsert handler accepts a null one.
  it('re-inserts a pair an older undo in the same reversal gives a view back', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews(null, 'friend'), 'act_0')
    const [created] = await pair(db)
    await apply(ctx, classifyMiraView('wary'), 'act_c')
    // A third, still-older delta on the same pair: it must land quietly after the revival.
    await apply(ctx, classifyMiraView('hostile'), 'act_c')
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(
      ctx,
      {
        kind: 'upsertCharacterRelationship',
        source: 'periodic_classifier',
        payload: { branchId: 'b1', subjectId: 'char_mira', objectId: 'char_kael', kind: null },
      },
      'act_x',
    )

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    const [row] = await pair(db)
    expect(row).toEqual({ ...created, kind: null, inverseKind: 'friend' })
    expect(characterRelationshipsStore.getById(row.id)).toEqual(row)
  })

  it('leaves a pair the user deleted since deleted', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews(null, 'friend'), 'act_0')
    const [created] = await pair(db)
    await apply(ctx, classifyMiraView('wary'), 'act_c')
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(
      ctx,
      {
        kind: 'deleteCharacterRelationship',
        source: 'user_edit',
        payload: { branchId: 'b1', id: created.id },
      },
      'act_u',
    )

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await pair(db)).toHaveLength(0)
  })

  // Out of order only after a redo re-inserts the create above deltas its snapshot absorbed.
  it('keeps a reversed create out even when older undos in the plan would give it a view', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('ally', null), 'act_0')
    const [row] = await pair(db)
    const delta = (
      id: string,
      logPosition: number,
      op: Delta['op'],
      undoPayload: Record<string, unknown> | null,
    ): Delta => ({
      id,
      branchId: 'b1',
      entryId: null,
      actionId: 'act_synthetic',
      logPosition,
      source: op === 'create' ? 'user_edit' : 'periodic_classifier',
      targetTable: 'character_relationships',
      targetId: row.id,
      op,
      undoPayload,
      encodingVersion: 1,
      createdAt: logPosition,
    })

    await reverseAndPruneDeltaRows(
      [
        delta('d_create', 30, 'create', null),
        delta('d_kael', 20, 'update', { kind: null }),
        delta('d_mira', 10, 'update', { inverseKind: 'friend' }),
      ],
      ctx,
    )

    expect(await pair(db)).toHaveLength(0)
  })

  it('updates a pair the reversal leaves with a view', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, userViews('ally', null), 'act_0')
    await apply(ctx, classifyMiraView('wary'), 'act_c')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    const [row] = await pair(db)
    expect(row).toMatchObject({ kind: 'ally', inverseKind: null })
    expect(characterRelationshipsStore.getById(row.id)).toEqual(row)
  })
})

describe('reversing a machine create of a relationship', () => {
  it("keeps the pair with the user's later view and nulls the classifier's", async () => {
    const { db, ctx } = await setup()
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(ctx, userViews('ally', 'wary'), 'act_u')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    const [row] = await pair(db)
    expect(row).toMatchObject({ kind: null, inverseKind: 'wary' })
    expect(characterRelationshipsStore.getById(row.id)).toEqual(row)
    expect(await actionIds(db)).toEqual(['act_u'])
  })

  it('leaves the pair as the user left it when the user wrote both views', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(ctx, userViews('rival', 'wary'), 'act_u')

    const plan = await buildReverseAndPrunePlan(await deltasOf(db, 'act_c'), ctx)
    expect(plan.ops).toEqual([])
    expect(plan.pruneOps).toHaveLength(1)

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)
    expect((await pair(db))[0]).toMatchObject({ kind: 'rival', inverseKind: 'wary' })
  })

  it('deletes the pair once the user cleared the view they had added', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, classifyView('ally'), 'act_c')
    await apply(ctx, userViews('ally', 'wary'), 'act_u1')
    await apply(ctx, userViews('ally', null), 'act_u2')

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await pair(db)).toHaveLength(0)
  })

  it('deletes the pair when no user edit followed', async () => {
    const { db, ctx } = await setup()
    await apply(ctx, classifyView('ally'), 'act_c')
    const [created] = await pair(db)

    await reverseAndPruneDeltaRows(await deltasOf(db, 'act_c'), ctx)

    expect(await pair(db)).toHaveLength(0)
    expect(characterRelationshipsStore.getById(created.id)).toBeUndefined()
  })
})

describe('a prose edit under a later user write', () => {
  it("keeps the view the user set after the reply's fact, and blocks its re-derivation", async () => {
    const { db, ctx } = await setup()
    const entry = (id: string, position: number, kind: 'user_action' | 'ai_reply') => ({
      kind: 'createStoryEntry' as const,
      source: 'user_edit' as const,
      payload: {
        entry: { id, branchId: 'b1', position, kind, content: `${id} prose`, createdAt: position },
      },
    })
    await apply(ctx, userViews('friend', 'friend'), 'act_0')
    await apply(ctx, entry('e_action', 1, 'user_action'), 'act_e1')
    await apply(ctx, entry('e_reply', 2, 'ai_reply'), 'act_e2')
    const fromReply: PipelineAction = {
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_kael',
        objectId: 'char_mira',
        kind: 'ally',
        proseEntryId: 'e_reply',
      },
    }
    await apply(ctx, fromReply, 'act_c', 'e_reply')
    await apply(ctx, userViews('rival', 'friend'), 'act_u')

    // Editing the head turn's origin reverses the reply's facts too.
    expect(await updateStoryEntryContent('b1', 'e_action', 'rewritten', ctx)).toEqual({
      status: 'ok',
    })

    expect((await pair(db))[0].kind).toBe('rival')
    expect(await deltasOf(db, 'act_c')).toEqual([])
    // The reply is unchanged, so the user's edit still outranks the fact it re-derives.
    const rederived = await applyDeltaAction(
      { action: fromReply, actionId: 'act_c2', branchId: 'b1', entryId: 'e_reply' },
      ctx,
    )
    expect(rederived).toEqual({ status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' })
    expect((await pair(db))[0].kind).toBe('rival')
  })
})
