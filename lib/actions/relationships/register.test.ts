import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, characterRelationships, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { characterRelationshipsStore } from '@/lib/stores'

import { registerCharacterRelationships } from './register'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

async function setup() {
  __resetRegistry()
  registerCharacterRelationships()
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
