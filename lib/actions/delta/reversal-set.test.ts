import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  storyEntries,
  translations,
  type CharacterRelationship,
  type Delta,
  type NewEntity,
  type Translation,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { applyDeltaAction } from './apply-delta-action'
import { EMPTY_HELD_ROWS, heldKey } from './held-rows'
import { ReversalIntegrityError } from './replay-errors'
import { reversalLockKeys, selectReversalSet } from './row-closure'
import { FIRST_LOGGED_AT } from './user-precedence'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const delta = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: 'act_run',
  op: 'create',
  entryId: null,
  source: 'periodic_classifier',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

const character = (id: string, branchId = 'b1'): NewEntity => ({
  id,
  branchId,
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const relationship = (
  id: string,
  aId: string,
  bId: string,
  branchId = 'b1',
): CharacterRelationship => ({
  id,
  branchId,
  aId,
  bId,
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
})

const translation = (
  id: string,
  targetKind: Translation['targetKind'],
  targetId: string,
): Translation => ({
  id,
  branchId: 'b1',
  targetKind,
  targetId,
  field: 'name',
  language: 'es',
  translatedText: 'x',
  createdAt: 1,
  updatedAt: 1,
})

const ids = (rows: readonly Delta[]) => rows.map((d) => d.id)

async function insertDeltas(...rows: Delta[]): Promise<void> {
  await ctx.db.insert(deltas).values(rows)
}

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await ctx.db.insert(entities).values(character('char_k'))
})

describe('selectReversalSet — the closure', () => {
  it('closes a user-created character over the links a later pass made to her (P1)', async () => {
    await ctx.db.insert(entities).values(character('char_x'))
    const act = (actionId: string) => async (action: PipelineAction) => {
      const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
      expect(result.status).toBe('ok')
    }
    await act('act_user')({
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_n') },
    })
    const pass = act('act_pass')
    await pass({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hap_p', branchId: 'b1', title: 'Fire', createdAt: 2, updatedAt: 2 },
      },
    })
    await pass({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_p', branchId: 'b1', happeningId: 'hap_p', entityId: 'char_n' },
      },
    })
    await pass({
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', happeningId: 'hap_p', characterId: 'char_n' },
    })
    await pass({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_n',
        objectId: 'char_x',
        kind: 'ally',
        inverseKind: 'ally',
      },
    })
    const target = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, 'act_user'))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const [awareness] = await ctx.db.select().from(happeningAwareness)
    const [rel] = await ctx.db.select().from(characterRelationships)

    const set = await selectReversalSet(ctx, { branchId: 'b1', target })

    expect(set.rows.map((d) => `${d.op} ${d.targetTable}:${d.targetId}`)).toEqual([
      `create character_relationships:${rel.id}`,
      `create happening_awareness:${awareness.id}`,
      'create happening_involvements:hinv_p',
      'create entities:char_n',
    ])
    expect(set.redoRows).toEqual(set.rows)
    expect(set.branchId).toBe('b1')
  })

  it('takes a row a delete captured when it names a removed row; the delete stays out', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    const rel = relationship('rel_1', 'char_p', 'char_x')
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
      delta('d_del', 3, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: {
          ...character('char_x'),
          involvements: [],
          awareness: [],
          relationships: [rel],
          translations: [],
        },
      }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_rel', 'd_p'])
    expect(set.held.byRow.get(heldKey('character_relationships', 'rel_1'))?.holder.id).toBe('d_del')
  })

  it('takes a row deleted on its own that names a removed row; its delete stays out', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
      delta('d_rel_del', 3, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        undoPayload: relationship('rel_1', 'char_k', 'char_p'),
      }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_rel', 'd_p'])
  })

  it("takes the rows a removed row's own delete captured, not the delete (P5)", async () => {
    const involvement = { id: 'hinv_u', branchId: 'b1', happeningId: 'hap_p', entityId: 'char_k' }
    await insertDeltas(
      delta('d_h', 1, { targetTable: 'happenings', targetId: 'hap_p' }),
      delta('d_inv', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'happening_involvements',
        targetId: 'hinv_u',
      }),
      delta('d_hdel', 3, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'happenings',
        targetId: 'hap_p',
        undoPayload: {
          id: 'hap_p',
          branchId: 'b1',
          title: 'Fire',
          createdAt: 1,
          updatedAt: 1,
          involvements: [involvement],
          awareness: [],
          translations: [],
        },
      }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_h', 1, { targetTable: 'happenings', targetId: 'hap_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_inv', 'd_h'])
  })

  it('closes to depth two: a character, a relationship naming her, its translation', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_1', 'char_k', 'char_p'))
    await ctx.db
      .insert(translations)
      .values(translation('tr_rel', 'character_relationship', 'rel_1'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel', 2, {
        actionId: 'act_other',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
      delta('d_tr', 3, { actionId: 'act_tr', targetTable: 'translations', targetId: 'tr_rel' }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_tr', 'd_rel', 'd_p'])
  })

  it("leaves out a translation of another kind that shares a removed row's id", async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(translations).values(translation('tr_lore', 'lore', 'char_p'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_tr', 2, { actionId: 'act_tr', targetTable: 'translations', targetId: 'tr_lore' }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_p'])
  })

  it('takes a translation of a removed story entry', async () => {
    await ctx.db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'Once.',
      createdAt: 1,
    })
    await ctx.db.insert(translations).values(translation('tr_e', 'story_entry', 'entry_1'))
    await insertDeltas(
      delta('d_e', 1, { targetTable: 'story_entries', targetId: 'entry_1' }),
      delta('d_tr', 2, { actionId: 'act_tr', targetTable: 'translations', targetId: 'tr_e' }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_e', 1, { targetTable: 'story_entries', targetId: 'entry_1' })],
    })

    expect(ids(set.rows)).toEqual(['d_tr', 'd_e'])
  })

  it('takes a relationship reached through a removed character, whatever views the user set', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_1', 'char_k', 'char_p'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel', 2, {
        actionId: 'act_other',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
      delta('d_view', 3, {
        actionId: 'act_user',
        source: 'user_edit',
        op: 'update',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        undoPayload: { kind: 'rival' },
      }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_view', 'd_rel', 'd_p'])
  })

  it('reads only the seed branch for writes to and live rows naming a removed row', async () => {
    await ctx.db.insert(entities).values([character('char_p'), character('char_p', 'b2')])
    await ctx.db
      .insert(characterRelationships)
      .values(relationship('rel_b2', 'char_k', 'char_p', 'b2'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel_b2', 1, {
        branchId: 'b2',
        targetTable: 'character_relationships',
        targetId: 'rel_b2',
      }),
      // A fork copies rows and deltas under the same target ids.
      delta('d_p_b2', 2, { branchId: 'b2', targetTable: 'entities', targetId: 'char_p' }),
    )

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(ids(set.rows)).toEqual(['d_p'])
  })
})

describe('selectReversalSet — row-keeping creates', () => {
  // rel_1: a pass created it, the user then changed its view, and a translation names it.
  async function seedKeptRelationship() {
    await ctx.db.insert(entities).values(character('char_x'))
    await ctx.db
      .insert(characterRelationships)
      .values({ ...relationship('rel_1', 'char_k', 'char_x'), kind: 'rival' })
    await ctx.db
      .insert(translations)
      .values(translation('tr_rel', 'character_relationship', 'rel_1'))
    const created = delta('d_rel', 1, { targetTable: 'character_relationships', targetId: 'rel_1' })
    const view = delta('d_view', 2, {
      actionId: 'act_user',
      source: 'user_edit',
      op: 'update',
      targetTable: 'character_relationships',
      targetId: 'rel_1',
      undoPayload: { kind: 'ally' },
    })
    await insertDeltas(
      created,
      view,
      delta('d_tr', 3, { actionId: 'act_tr', targetTable: 'translations', targetId: 'tr_rel' }),
    )
    return { created, view }
  }

  it('keeps a create the user wrote a view of out of the removed set, with its referrers', async () => {
    const { created } = await seedKeptRelationship()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created] })

    expect(ids(set.rows)).toEqual(['d_rel'])
  })

  it('judges the keeping write against the seed: a sweep holding it removes the row', async () => {
    const { created, view } = await seedKeptRelationship()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created], sweep: [view] })

    expect(ids(set.redoRows)).toEqual(['d_rel'])
    expect(ids(set.rows)).toEqual(['d_tr', 'd_view', 'd_rel'])
  })

  it('judges the keeping write by where it first logged: a view redone above the create keeps nothing', async () => {
    await ctx.db.insert(entities).values(character('char_x'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_1', 'char_k', 'char_x'))
    const created = delta('d_rel', 2, { targetTable: 'character_relationships', targetId: 'rel_1' })
    await insertDeltas(
      created,
      delta('d_view', 3, {
        actionId: 'act_user',
        source: 'user_edit',
        op: 'update',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
        undoPayload: { kind: 'ally', [FIRST_LOGGED_AT]: 1 },
      }),
    )

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created] })

    expect(ids(set.rows)).toEqual(['d_view', 'd_rel'])
  })

  it('removes a kept create a removed row in the seed reaches, with the view that kept it', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db
      .insert(characterRelationships)
      .values({ ...relationship('rel_p', 'char_k', 'char_p'), kind: 'rival' })
    const createdChar = delta('d_char', 1, { targetTable: 'entities', targetId: 'char_p' })
    const createdRel = delta('d_rel', 2, {
      targetTable: 'character_relationships',
      targetId: 'rel_p',
    })
    await insertDeltas(
      createdChar,
      createdRel,
      delta('d_view', 3, {
        actionId: 'act_user',
        source: 'user_edit',
        op: 'update',
        targetTable: 'character_relationships',
        targetId: 'rel_p',
        undoPayload: { kind: 'ally' },
      }),
    )

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [createdRel, createdChar] })

    expect(ids(set.rows)).toEqual(['d_view', 'd_rel', 'd_char'])
  })

  it("never keeps a user's own create, whatever view the user set after it", async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db
      .insert(characterRelationships)
      .values({ ...relationship('rel_u', 'char_k', 'char_p'), kind: 'rival' })
    const created = delta('d_rel', 1, {
      actionId: 'act_user0',
      source: 'user_edit',
      targetTable: 'character_relationships',
      targetId: 'rel_u',
    })
    await insertDeltas(
      created,
      delta('d_view', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        op: 'update',
        targetTable: 'character_relationships',
        targetId: 'rel_u',
        undoPayload: { kind: 'ally' },
      }),
    )

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created] })

    expect(ids(set.rows)).toEqual(['d_view', 'd_rel'])
  })

  it('removes a create no user write kept, with its later writes and referrers', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_2', 'char_k', 'char_p'))
    await ctx.db.insert(translations).values(translation('tr_2', 'character_relationship', 'rel_2'))
    const created = delta('d_rel2', 1, {
      targetTable: 'character_relationships',
      targetId: 'rel_2',
    })
    await insertDeltas(
      created,
      delta('d_upd', 2, {
        actionId: 'act_other',
        op: 'update',
        targetTable: 'character_relationships',
        targetId: 'rel_2',
        undoPayload: { kind: 'rival' },
      }),
      delta('d_tr2', 3, { actionId: 'act_tr', targetTable: 'translations', targetId: 'tr_2' }),
    )

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created] })

    expect(ids(set.rows)).toEqual(['d_tr2', 'd_upd', 'd_rel2'])
  })
})

describe('selectReversalSet — redo labels', () => {
  // char_p's create reaches hinv_1; the sweep's hap_s create reaches haw_s.
  async function seedTargetAndSweep() {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(happenings).values([
      { id: 'hap_k', branchId: 'b1', title: 'Old', createdAt: 1, updatedAt: 1 },
      { id: 'hap_s', branchId: 'b1', title: 'Swept', createdAt: 1, updatedAt: 1 },
    ])
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_k', entityId: 'char_p' })
    await ctx.db
      .insert(happeningAwareness)
      .values({ id: 'haw_s', branchId: 'b1', happeningId: 'hap_s', characterId: 'char_k' })
    const created = delta('d_p', 1, {
      actionId: 'act_t',
      targetTable: 'entities',
      targetId: 'char_p',
    })
    const involvement = delta('d_inv', 2, {
      actionId: 'act_i',
      targetTable: 'happening_involvements',
      targetId: 'hinv_1',
    })
    const swept = delta('d_h', 3, {
      actionId: 'act_s',
      targetTable: 'happenings',
      targetId: 'hap_s',
    })
    await insertDeltas(
      created,
      involvement,
      swept,
      delta('d_aw', 4, {
        actionId: 'act_a',
        targetTable: 'happening_awareness',
        targetId: 'haw_s',
      }),
    )
    return { created, involvement, swept }
  }

  it("labels the target's closure for redo and leaves a sweep-only row out of it", async () => {
    const { created, swept } = await seedTargetAndSweep()

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created], sweep: [swept] })

    expect(ids(set.redoRows)).toEqual(['d_inv', 'd_p'])
    expect(ids(set.rows)).toEqual(['d_aw', 'd_h', 'd_inv', 'd_p'])
  })

  it("counts a delta both reach as the closure's, once", async () => {
    const { created, involvement, swept } = await seedTargetAndSweep()

    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [created],
      sweep: [swept, involvement],
    })

    expect(ids(set.redoRows)).toEqual(['d_inv', 'd_p'])
    expect(ids(set.rows)).toEqual(['d_aw', 'd_h', 'd_inv', 'd_p'])
  })
})

describe('selectReversalSet — refusals and edges', () => {
  it('refuses a row reached by reference whose create is not in the log (no-create)', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_x', 'char_k', 'char_p'))
    const created = delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })
    await insertDeltas(created)

    const refused = await selectReversalSet(ctx, { branchId: 'b1', target: [created] }).catch(
      (e: unknown) => e,
    )

    expect(refused).toBeInstanceOf(ReversalIntegrityError)
    expect(refused).toMatchObject({
      refusal: 'no-create',
      actionId: 'act_run',
      committed: false,
      message: 'Reversal refused (no-create): character_relationships:rel_x',
    })
  })

  it('refuses a held row reached by reference whose create is not in the log', async () => {
    const created = delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })
    await insertDeltas(
      created,
      delta('d_del', 2, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: {
          ...character('char_x'),
          relationships: [relationship('rel_h', 'char_p', 'char_x')],
        },
      }),
    )

    const refused = await selectReversalSet(ctx, { branchId: 'b1', target: [created] }).catch(
      (e: unknown) => e,
    )

    expect(refused).toBeInstanceOf(ReversalIntegrityError)
    expect(refused).toMatchObject({
      refusal: 'no-create',
      message: 'Reversal refused (no-create): character_relationships:rel_h',
    })
  })

  it("carries the first seed delta's actionId on a refusal", async () => {
    await ctx.db.insert(entities).values([character('char_p'), character('char_q')])
    await ctx.db.insert(characterRelationships).values(relationship('rel_x', 'char_k', 'char_p'))
    const first = delta('d_p', 1, {
      actionId: 'act_first',
      targetTable: 'entities',
      targetId: 'char_p',
    })
    const second = delta('d_q', 2, {
      actionId: 'act_second',
      targetTable: 'entities',
      targetId: 'char_q',
    })
    await insertDeltas(first, second)

    const refused = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [first, second],
    }).catch((e: unknown) => e)

    expect(refused).toMatchObject({ refusal: 'no-create', actionId: 'act_first' })
  })

  it('refuses a seed delta from another branch', async () => {
    const stray = delta('d_b2', 1, { branchId: 'b2', targetTable: 'entities', targetId: 'char_k' })

    const refused = await selectReversalSet(ctx, { branchId: 'b1', target: [stray] }).catch(
      (e: unknown) => e,
    )

    expect(refused).toBeInstanceOf(Error)
    expect(refused).not.toBeInstanceOf(ReversalIntegrityError)
    expect((refused as Error).message).toBe(
      'selectReversalSet: delta d_b2 is on b2, not the seed branch b1',
    )
  })

  it('refuses a sweep delta from another branch', async () => {
    const created = delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })
    const stray = delta('d_b2', 1, { branchId: 'b2', targetTable: 'entities', targetId: 'char_k' })

    const refused = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [created],
      sweep: [stray],
    }).catch((e: unknown) => e)

    expect((refused as Error).message).toBe(
      'selectReversalSet: delta d_b2 is on b2, not the seed branch b1',
    )
  })

  it('closes over a sweep when the target is empty, labelling nothing for redo', async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await ctx.db.insert(characterRelationships).values(relationship('rel_1', 'char_k', 'char_p'))
    const swept = delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })
    await insertDeltas(
      swept,
      delta('d_rel', 2, {
        actionId: 'act_other',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
    )

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [], sweep: [swept] })

    expect(ids(set.rows)).toEqual(['d_rel', 'd_p'])
    expect(set.redoRows).toEqual([])
  })

  it('returns an empty set for an empty seed without a query', async () => {
    const select = vi.spyOn(ctx.db, 'select')

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [], sweep: [] })

    expect(set.rows).toEqual([])
    expect(set.redoRows).toEqual([])
    expect(set.held).toBe(EMPTY_HELD_ROWS)
    expect(select).not.toHaveBeenCalled()
    select.mockRestore()
  })
})

describe('reversalLockKeys', () => {
  it("locks the set's rows and every delete holding a row it writes", async () => {
    await ctx.db.insert(entities).values(character('char_p'))
    await insertDeltas(
      delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' }),
      delta('d_rel', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'character_relationships',
        targetId: 'rel_1',
      }),
      delta('d_del', 3, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: {
          ...character('char_x'),
          relationships: [relationship('rel_1', 'char_p', 'char_x')],
        },
      }),
    )
    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: [delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })],
    })

    expect(new Set(reversalLockKeys(set))).toEqual(
      new Set([
        'character_relationships:b1',
        'entities:b1:char_p',
        'happening_links:b1',
        // d_del holds rel_1, which the set's d_rel writes.
        'entities:b1:char_x',
      ]),
    )
  })

  it('locks the delete holding a row only the sweep reaches', async () => {
    const created = delta('d_p', 1, { targetTable: 'entities', targetId: 'char_p' })
    const swept = delta('d_q', 2, {
      actionId: 'act_s',
      targetTable: 'entities',
      targetId: 'char_q',
    })
    await insertDeltas(
      created,
      swept,
      delta('d_rel', 3, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'character_relationships',
        targetId: 'rel_q',
      }),
      delta('d_del', 4, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: {
          ...character('char_x'),
          relationships: [relationship('rel_q', 'char_q', 'char_x')],
        },
      }),
    )
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [created], sweep: [swept] })

    expect(ids(set.redoRows)).toEqual(['d_p'])
    expect(new Set(reversalLockKeys(set))).toEqual(
      new Set([
        'character_relationships:b1',
        'entities:b1:char_p',
        'entities:b1:char_q',
        'happening_links:b1',
        // d_del holds rel_q, which only the sweep's char_q reaches.
        'entities:b1:char_x',
      ]),
    )
  })
})
