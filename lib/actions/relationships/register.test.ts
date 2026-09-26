import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, characterRelationships, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { characterRelationshipsStore, entriesStore, undoRedoStore } from '@/lib/stores'

import { registerCharacterRelationships } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { USER_EDITED_SINCE_PROSE } from '../delta/user-precedence'
import { registerStoryEntries } from '../story-entries/register'
import { redoLastAction, undoLastAction } from '../story-entries/undo'

async function setup() {
  __resetRegistry()
  registerCharacterRelationships()
  registerStoryEntries()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  characterRelationshipsStore.__reset()
  characterRelationshipsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

async function pairRow(db: Awaited<ReturnType<typeof setup>>['db'], aId: string, bId: string) {
  return db
    .select()
    .from(characterRelationships)
    .where(and(eq(characterRelationships.aId, aId), eq(characterRelationships.bId, bId)))
}

const upsert = (subjectId: string, objectId: string, kind: string | null, actionId: string) => ({
  action: {
    kind: 'upsertCharacterRelationship' as const,
    source: 'ai_classifier' as const,
    payload: { branchId: 'br_1', subjectId, objectId, kind },
  },
  actionId,
  branchId: 'br_1',
})

// char_aria < char_kael lexicographically → canonical a=aria, b=kael
describe('character_relationships upsert', () => {
  it('two POV writes merge into one canonically-ordered row (the data-model worked example)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_1'), ctx)
    let rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBeNull()
    expect(rows[0].inverseKind).toBe('sister')

    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_2'), ctx)
    rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBe('brother')
    expect(rows[0].inverseKind).toBe('sister')
  })

  it('contradicting prose overwrites the right POV', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_1'), ctx)
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'rival', 'act_2'), ctx)
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].kind).toBe('rival')
    expect(rows[0].inverseKind).toBeNull()
  })

  it('nulling the last remaining POV deletes the row; reverse-replay restores both POVs', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_1'), ctx)
    await applyDeltaAction(upsert('char_kael', 'char_aria', null, 'act_2'), ctx)
    expect((await pairRow(db, 'char_aria', 'char_kael')).length).toBe(0)
    expect(await reverseReplayDeltas('act_2', ctx)).toBe(1)
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows.length).toBe(1)
    expect(rows[0].inverseKind).toBe('sister')
  })

  it('nulling one POV while the other survives is an update, not a delete', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_1'), ctx)
    await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_2'), ctx)
    await applyDeltaAction(upsert('char_aria', 'char_kael', null, 'act_3'), ctx)
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBeNull()
    expect(rows[0].inverseKind).toBe('sister')
  })

  it('is a no-op when the subject-as-a write repeats the stored view', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_1'), ctx)
    const result = await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_2'), ctx)
    expect(result).toEqual({
      status: 'rejected',
      reason: 'relationship unchanged',
      code: 'noop',
    })
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].kind).toBe('brother')
    expect(await deltasFor(db, 'act_2')).toHaveLength(0)
  })

  it('is a no-op when the subject-as-b write repeats the stored view', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_1'), ctx)
    const result = await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_2'), ctx)
    expect(result).toEqual({
      status: 'rejected',
      reason: 'relationship unchanged',
      code: 'noop',
    })
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].inverseKind).toBe('sister')
    expect(await deltasFor(db, 'act_2')).toHaveLength(0)
  })

  it('is a no-op when the write is a case variant of the stored view', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'sister', 'act_1'), ctx)
    const result = await applyDeltaAction(upsert('char_aria', 'char_kael', 'Sister', 'act_2'), ctx)
    expect(result).toEqual({
      status: 'rejected',
      reason: 'relationship unchanged',
      code: 'noop',
    })
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].kind).toBe('sister')
    expect(await deltasFor(db, 'act_2')).toHaveLength(0)
  })

  it('is a no-op when the write is a whitespace variant of the stored view', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'sister', 'act_1'), ctx)
    const result = await applyDeltaAction(
      upsert('char_aria', 'char_kael', ' sister ', 'act_2'),
      ctx,
    )
    expect(result).toEqual({
      status: 'rejected',
      reason: 'relationship unchanged',
      code: 'noop',
    })
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].kind).toBe('sister')
    expect(await deltasFor(db, 'act_2')).toHaveLength(0)
  })

  it('is a no-op when a single-perspective clear targets an already-null view', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_kael', 'char_aria', 'sister', 'act_1'), ctx)
    const result = await applyDeltaAction(upsert('char_aria', 'char_kael', null, 'act_2'), ctx)
    expect(result).toEqual({
      status: 'rejected',
      reason: 'relationship unchanged',
      code: 'noop',
    })
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0].kind).toBeNull()
    expect(rows[0].inverseKind).toBe('sister')
    expect(await deltasFor(db, 'act_2')).toHaveLength(0)
  })

  it('rejects a null-POV write against a non-existent pair', async () => {
    const { ctx } = await setup()
    const res = await applyDeltaAction(upsert('char_aria', 'char_kael', null, 'act_1'), ctx)
    expect(res.status).toBe('rejected')
  })

  it('rejects a self-relationship', async () => {
    const { ctx } = await setup()
    const res = await applyDeltaAction(upsert('char_aria', 'char_aria', 'self', 'act_1'), ctx)
    expect(res.status).toBe('rejected')
  })

  it('DDL backstops: a_id >= b_id and both-POV-null direct inserts are rejected', async () => {
    const { ctx } = await setup()
    await expect(
      ctx.runInTransaction([
        ctx.db
          .insert(characterRelationships)
          .values({
            id: 'rel_x',
            branchId: 'br_1',
            aId: 'char_kael',
            bId: 'char_aria',
            kind: 'x',
            inverseKind: null,
            createdAt: 1,
            updatedAt: 1,
          })
          .toSQL(),
      ]),
    ).rejects.toThrow()
    await expect(
      ctx.runInTransaction([
        ctx.db
          .insert(characterRelationships)
          .values({
            id: 'rel_y',
            branchId: 'br_1',
            aId: 'char_aria',
            bId: 'char_kael',
            kind: null,
            inverseKind: null,
            createdAt: 1,
            updatedAt: 1,
          })
          .toSQL(),
      ]),
    ).rejects.toThrow()
  })

  it('create patches the store; delete arm by id reverses', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_1'), ctx)
    const [created] = await pairRow(db, 'char_aria', 'char_kael')
    expect(characterRelationshipsStore.getById(created.id)?.kind).toBe('brother')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteCharacterRelationship',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: created.id },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await pairRow(db, 'char_aria', 'char_kael')).length).toBe(0)
    expect(characterRelationshipsStore.getById(created.id)).toBeUndefined()
    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(characterRelationshipsStore.getById(created.id)?.kind).toBe('brother')
  })
})

const upsertBoth = (
  subjectId: string,
  objectId: string,
  kind: string | null,
  inverseKind: string | null,
  actionId: string,
) => ({
  action: {
    kind: 'upsertCharacterRelationship' as const,
    source: 'user_edit' as const,
    payload: { branchId: 'br_1', subjectId, objectId, kind, inverseKind },
  },
  actionId,
  branchId: 'br_1',
})

async function deltasFor(db: Awaited<ReturnType<typeof setup>>['db'], actionId: string) {
  return db.select().from(deltas).where(eq(deltas.actionId, actionId))
}

describe('both-perspective upsert (World relationship editor)', () => {
  // Subject kael sorts after object aria, so the row is a=aria, b=kael and the POVs flip columns.
  it('writes both perspectives as one delta into one canonically ordered row', async () => {
    const { db, ctx } = await setup()
    const result = await applyDeltaAction(
      upsertBoth('char_kael', 'char_aria', 'sister', 'brother', 'act_1'),
      ctx,
    )
    expect(result.status).toBe('ok')
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'brother', inverseKind: 'sister' })
    expect(await deltasFor(db, 'act_1')).toHaveLength(1)
    expect(characterRelationshipsStore.getById(rows[0].id)).toMatchObject({
      kind: 'brother',
      inverseKind: 'sister',
    })
  })

  it('creates the row from the other perspective alone', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', null, 'rival', 'act_1'), ctx)
    const rows = await pairRow(db, 'char_aria', 'char_kael')
    expect(rows[0]).toMatchObject({ kind: null, inverseKind: 'rival' })
  })

  it('refuses both perspectives empty', async () => {
    const { db, ctx } = await setup()
    const result = await applyDeltaAction(
      upsertBoth('char_aria', 'char_kael', null, null, 'act_1'),
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await pairRow(db, 'char_aria', 'char_kael')).toHaveLength(0)
  })

  it('updates both columns of an existing row in one delta; reverse-replay restores both', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsert('char_aria', 'char_kael', 'brother', 'act_1'), ctx)
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', 'rival', 'wary', 'act_2'), ctx)
    const [updated] = await pairRow(db, 'char_aria', 'char_kael')
    expect(updated).toMatchObject({ kind: 'rival', inverseKind: 'wary' })
    expect(characterRelationshipsStore.getById(updated.id)).toMatchObject({
      kind: 'rival',
      inverseKind: 'wary',
    })
    const [delta] = await deltasFor(db, 'act_2')
    expect(delta.undoPayload).toEqual({ kind: 'brother', inverseKind: null })
    expect(await reverseReplayDeltas('act_2', ctx)).toBe(1)
    const [reverted] = await pairRow(db, 'char_aria', 'char_kael')
    expect(reverted).toMatchObject({ kind: 'brother', inverseKind: null })
    expect(characterRelationshipsStore.getById(reverted.id)).toMatchObject({
      kind: 'brother',
      inverseKind: null,
    })
  })

  it('writes only the changed column when clearing one side; reverse-replay restores it', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', 'brother', 'sister', 'act_1'), ctx)
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', 'brother', null, 'act_2'), ctx)
    const [cleared] = await pairRow(db, 'char_aria', 'char_kael')
    expect(cleared).toMatchObject({ kind: 'brother', inverseKind: null })
    expect(characterRelationshipsStore.getById(cleared.id)).toMatchObject({
      kind: 'brother',
      inverseKind: null,
    })
    const [delta] = await deltasFor(db, 'act_2')
    expect(delta.undoPayload).toEqual({ inverseKind: 'sister' })
    expect(await reverseReplayDeltas('act_2', ctx)).toBe(1)
    expect((await pairRow(db, 'char_aria', 'char_kael'))[0]).toMatchObject({
      kind: 'brother',
      inverseKind: 'sister',
    })
  })

  it('refuses both perspectives empty against an existing row, leaving it unchanged', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', 'brother', 'sister', 'act_1'), ctx)
    const result = await applyDeltaAction(
      upsertBoth('char_aria', 'char_kael', null, null, 'act_2'),
      ctx,
    )
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'a relationship needs at least one perspective',
    })
    expect((await pairRow(db, 'char_aria', 'char_kael'))[0]).toMatchObject({
      kind: 'brother',
      inverseKind: 'sister',
    })
  })

  it('is a no-op when both perspectives match the stored row', async () => {
    const { ctx } = await setup()
    await applyDeltaAction(upsertBoth('char_aria', 'char_kael', 'ally', 'ally', 'act_1'), ctx)
    const result = await applyDeltaAction(
      upsertBoth('char_aria', 'char_kael', 'ally', 'ally', 'act_2'),
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'noop' })
  })
})

// cadence.md → User edits and classifier writes. char_kael < char_mira, so the row is
// a=kael, b=mira and Kael's view of Mira is the `kind` column.
describe('single-perspective upsert against a user edit newer than the prose', () => {
  const PROSE = 'e_prose'
  const writeProse = (ctx: Awaited<ReturnType<typeof setup>>['ctx'], id = PROSE, position = 1) =>
    applyDeltaAction(
      {
        action: {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id,
              branchId: 'br_1',
              position,
              kind: 'ai_reply',
              content: 'Kael swore himself to Mira.',
              createdAt: 1,
            },
          },
        },
        actionId: `act_${id}`,
        branchId: 'br_1',
      },
      ctx,
    )
  const classify = (kind: string | null, actionId: string, proseEntryId = PROSE) => ({
    action: {
      kind: 'upsertCharacterRelationship' as const,
      source: 'periodic_classifier' as const,
      payload: {
        branchId: 'br_1',
        subjectId: 'char_kael',
        objectId: 'char_mira',
        kind,
        proseEntryId,
      },
    },
    actionId,
    branchId: 'br_1',
  })
  const views = (kael: string | null, mira: string | null, actionId: string) =>
    upsertBoth('char_kael', 'char_mira', kael, mira, actionId)
  const userWon = { status: 'rejected', reason: USER_EDITED_SINCE_PROSE, code: 'noop' }

  it("keeps Kael's view of Mira that the user set after the prose", async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx)
    await applyDeltaAction(views('rival', 'friend', 'act_u'), ctx)
    expect(await applyDeltaAction(classify('ally', 'act_k'), ctx)).toEqual(userWon)
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('rival')
  })

  it("writes Kael's view when the user changed only Mira's after the prose", async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx)
    await applyDeltaAction(views('friend', 'wary', 'act_u'), ctx)
    expect((await applyDeltaAction(classify('ally', 'act_k'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0]).toMatchObject({
      kind: 'ally',
      inverseKind: 'wary',
    })
  })

  it('creates nothing for a pair the user deleted after the prose', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx)
    const [row] = await pairRow(db, 'char_kael', 'char_mira')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteCharacterRelationship',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: row.id },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await applyDeltaAction(classify('ally', 'act_k'), ctx)).toEqual(userWon)
    expect(await pairRow(db, 'char_kael', 'char_mira')).toHaveLength(0)
  })

  it('keeps a view the user set creating the pair after the prose', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx)
    await applyDeltaAction(views('rival', 'wary', 'act_u'), ctx)
    expect(await applyDeltaAction(classify('ally', 'act_k'), ctx)).toEqual(userWon)
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('rival')
  })

  it('fills a view the user left blank creating the pair after the prose', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx)
    await applyDeltaAction(views(null, 'wary', 'act_u'), ctx)
    expect((await applyDeltaAction(classify('ally', 'act_k'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0]).toMatchObject({
      kind: 'ally',
      inverseKind: 'wary',
    })
  })

  it('fills a view the user left blank re-creating a pair they deleted after the prose', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx)
    const [row] = await pairRow(db, 'char_kael', 'char_mira')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteCharacterRelationship',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: row.id },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(views(null, 'wary', 'act_u'), ctx)
    expect((await applyDeltaAction(classify('ally', 'act_k'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0]).toMatchObject({
      kind: 'ally',
      inverseKind: 'wary',
    })
  })

  it('keeps older prose off a pair the user deleted, after newer prose re-created it', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx, 'e_old', 1)
    const [row] = await pairRow(db, 'char_kael', 'char_mira')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteCharacterRelationship',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: row.id },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    await writeProse(ctx, 'e_new', 2)
    expect((await applyDeltaAction(classify('ally', 'act_k1', 'e_new'), ctx)).status).toBe('ok')
    const miraView = await applyDeltaAction(
      {
        action: {
          kind: 'upsertCharacterRelationship',
          source: 'periodic_classifier',
          payload: {
            branchId: 'br_1',
            subjectId: 'char_mira',
            objectId: 'char_kael',
            kind: 'sister',
            proseEntryId: 'e_old',
          },
        },
        actionId: 'act_k2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(miraView).toEqual(userWon)
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0]).toMatchObject({
      kind: 'ally',
      inverseKind: null,
    })
  })

  // A live-row read would see `friend` at the second write and credit it to the user's create.
  it('reads a blank view at create from the chain after an older fact filled it', async () => {
    const { db, ctx } = await setup()
    await writeProse(ctx, 'e_p0', 1)
    await writeProse(ctx, 'e_p', 2)
    await applyDeltaAction(views(null, 'wary', 'act_u'), ctx)
    expect((await applyDeltaAction(classify('friend', 'act_k0', 'e_p0'), ctx)).status).toBe('ok')
    expect((await applyDeltaAction(classify('ally', 'act_k1', 'e_p'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('ally')
  })

  // Redo re-inserts the create at the log head, above the fill its snapshot absorbed.
  it('reads a blank view at create through an undo and redo of the create', async () => {
    const { db, ctx } = await setup()
    entriesStore.hydrate('br_1', [])
    undoRedoStore.clear()
    await writeProse(ctx, 'e_p0', 1)
    await applyDeltaAction(views(null, 'wary', 'act_u'), ctx)
    expect((await applyDeltaAction(classify('friend', 'act_k0', 'e_p0'), ctx)).status).toBe('ok')
    expect(await undoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    expect(await pairRow(db, 'char_kael', 'char_mira')).toHaveLength(0)
    expect(await redoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('friend')

    expect((await applyDeltaAction(classify('ally', 'act_k1', 'e_p0'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('ally')
    entriesStore.__reset()
  })

  it("does not count the classifier's own delete of the pair as the user's", async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', null, 'act_0'), ctx)
    await writeProse(ctx)
    expect((await applyDeltaAction(classify(null, 'act_k0'), ctx)).status).toBe('ok')
    expect(await pairRow(db, 'char_kael', 'char_mira')).toHaveLength(0)
    expect((await applyDeltaAction(classify('ally', 'act_k1'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('ally')
  })

  it('overwrites a view the user set before the prose', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await applyDeltaAction(views('rival', 'friend', 'act_u'), ctx)
    await writeProse(ctx)
    expect((await applyDeltaAction(classify('ally', 'act_k'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('ally')
  })

  it("lets the prose through once the user's newer edit is undone", async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(views('friend', 'friend', 'act_0'), ctx)
    await writeProse(ctx)
    await applyDeltaAction(views('rival', 'friend', 'act_u'), ctx)
    expect(await applyDeltaAction(classify('ally', 'act_k1'), ctx)).toEqual(userWon)
    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await applyDeltaAction(classify('ally', 'act_k2'), ctx)).status).toBe('ok')
    expect((await pairRow(db, 'char_kael', 'char_mira'))[0].kind).toBe('ally')
  })
})
