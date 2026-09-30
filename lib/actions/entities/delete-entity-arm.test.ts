import type { DatabaseSync } from 'node:sqlite'

import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  translations,
  type Delta,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { characterRelationshipsStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { applyRedo, snapshotForRedo } from '../delta/redo'
import { TARGET_NOT_FOUND } from '../delta/registry'
import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { ENTITY_DELETE_REJECTION } from './register'

const character = (id: string, branchId: string, name: string): NewEntity => ({
  id,
  branchId,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

let ctx: DbCtx
let sqlite: DatabaseSync

beforeEach(async () => {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  sqlite = test.sqlite
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
    .values([character('char_lead', 'b1', 'Kael'), character('char_x', 'b1', 'Mira')])
  await ctx.db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
  await ctx.db
    .insert(happeningInvolvements)
    .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_x' })
  await ctx.db
    .insert(happeningAwareness)
    .values({ id: 'haw_1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_x' })
  const pair = {
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_lead',
    bId: 'char_x',
    kind: 'ally',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
  }
  await ctx.db.insert(characterRelationships).values(pair)
  characterRelationshipsStore.hydrate('b1', [pair as never])
  await ctx.db.insert(translations).values([
    {
      id: 'tr_1',
      branchId: 'b1',
      targetKind: 'entity',
      targetId: 'char_x',
      field: 'name',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tr_2',
      branchId: 'b1',
      targetKind: 'character_relationship',
      targetId: 'rel_1',
      field: 'kind',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
})

const remove = (id: string, branchId = 'b1') =>
  applyDeltaAction(
    {
      action: { kind: 'deleteEntity', source: 'user_edit', payload: { branchId, id } },
      actionId: 'act_del',
      branchId,
    },
    ctx,
  )

describe('deleteEntity', () => {
  it('refuses the story lead and writes nothing', async () => {
    expect(await remove('char_lead')).toMatchObject({
      status: 'rejected',
      code: ENTITY_DELETE_REJECTION.leadEntity,
    })
    expect(await ctx.db.select().from(entities)).toHaveLength(2)
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('refuses a target that is already gone with not-found', async () => {
    expect(await remove('char_ghost')).toMatchObject({
      status: 'rejected',
      code: TARGET_NOT_FOUND,
    })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('cascades its link rows and their translations, and restores them on undo', async () => {
    expect(await remove('char_x')).toMatchObject({ status: 'ok' })
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
    expect(await ctx.db.select().from(happeningAwareness)).toEqual([])
    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
    expect(await ctx.db.select().from(translations)).toEqual([])
    expect(characterRelationshipsStore.getRelationshipRows().has('rel_1')).toBe(false)

    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, 'act_del'))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    expect(rows).toHaveLength(1)
    await reverseAndPruneDeltaRows(rows, ctx)

    const [restored] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))
    expect(restored.embeddingStale).toBe(1)
    expect(await ctx.db.select().from(happeningInvolvements)).toHaveLength(1)
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
    expect(await ctx.db.select().from(characterRelationships)).toHaveLength(1)
    expect(await ctx.db.select().from(translations)).toHaveLength(2)
  })

  it('scopes the cascade to the branch, leaving a sibling branch untouched, and undoes without a PK conflict', async () => {
    // b2 shares every id with b1, so a missing branch filter would leak into the sibling's rows.
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm2', createdAt: 1 })
    await ctx.db
      .insert(entities)
      .values([character('char_lead', 'b2', 'Kael'), character('char_x', 'b2', 'Mira')])
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_1', branchId: 'b2', happeningId: 'hap_1', entityId: 'char_x' })
    await ctx.db
      .insert(happeningAwareness)
      .values({ id: 'haw_1', branchId: 'b2', happeningId: 'hap_1', characterId: 'char_x' })
    const pairB2 = {
      id: 'rel_1',
      branchId: 'b2',
      aId: 'char_lead',
      bId: 'char_x',
      kind: 'ally',
      inverseKind: null,
      createdAt: 1,
      updatedAt: 1,
    }
    await ctx.db.insert(characterRelationships).values(pairB2)
    await ctx.db.insert(translations).values([
      {
        id: 'tr_1',
        branchId: 'b2',
        targetKind: 'entity',
        targetId: 'char_x',
        field: 'name',
        language: 'cs',
        translatedText: 'x',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'tr_2',
        branchId: 'b2',
        targetKind: 'character_relationship',
        targetId: 'rel_1',
        field: 'kind',
        language: 'cs',
        translatedText: 'x',
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    expect(await remove('char_x')).toMatchObject({ status: 'ok' })

    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b2')),
    ).toHaveLength(1)
    expect(
      await ctx.db.select().from(happeningAwareness).where(eq(happeningAwareness.branchId, 'b2')),
    ).toHaveLength(1)
    expect(
      await ctx.db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.branchId, 'b2')),
    ).toHaveLength(1)
    expect(
      await ctx.db.select().from(translations).where(eq(translations.branchId, 'b2')),
    ).toHaveLength(2)

    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, 'act_del'))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const [delta] = rows
    const payload = delta.undoPayload as Record<string, unknown[]>
    expect(payload.involvements).toHaveLength(1)
    expect(payload.awareness).toHaveLength(1)
    expect(payload.relationships).toHaveLength(1)
    expect(payload.translations).toHaveLength(2)

    await reverseAndPruneDeltaRows(rows, ctx)
    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b1')),
    ).toHaveLength(1)
    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b2')),
    ).toHaveLength(1)
  })

  it('sweeps the entity own vectors forward, restores it stale on undo, and sweeps again on redo', async () => {
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
    for (const dim of [384, 8]) {
      sqlite
        .prepare(
          `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `b1:char_x:m${dim}`,
          'b1',
          `m${dim}`,
          'char_x',
          'h',
          new Uint8Array(new Float32Array(dim).buffer),
        )
    }
    const vectorCount = (): number => {
      const rows = sqlite
        .prepare(
          `SELECT (SELECT count(*) FROM entities_vec_384 WHERE id = 'char_x') + (SELECT count(*) FROM entities_vec_8 WHERE id = 'char_x') AS n`,
        )
        .all() as { n: number }[]
      return rows[0].n
    }
    expect(vectorCount()).toBe(2)

    expect(await remove('char_x')).toMatchObject({ status: 'ok' })
    expect(vectorCount()).toBe(0)

    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, 'act_del'))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const snapshot = await snapshotForRedo(rows, ctx)
    await reverseAndPruneDeltaRows(rows, ctx)
    const [restored] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))
    expect(restored.embeddingStale).toBe(1)

    for (const dim of [384, 8]) {
      sqlite
        .prepare(
          `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `b1:char_x:m${dim}`,
          'b1',
          `m${dim}`,
          'char_x',
          'h',
          new Uint8Array(new Float32Array(dim).buffer),
        )
    }
    await applyRedo(snapshot, ctx)
    expect(vectorCount()).toBe(0)
  })

  it('cascades a relationship where the deleted entity is the aId side, and restores it on undo', async () => {
    // Pairs store aId < bId; char_x on the aId side here pins the `or(aId, bId)` cascade's other arm.
    await ctx.db.insert(entities).values(character('char_z', 'b1', 'Zed'))
    const pair2 = {
      id: 'rel_2',
      branchId: 'b1',
      aId: 'char_x',
      bId: 'char_z',
      kind: 'rival',
      inverseKind: null,
      createdAt: 1,
      updatedAt: 1,
    }
    await ctx.db.insert(characterRelationships).values(pair2)
    await ctx.db.insert(translations).values({
      id: 'tr_3',
      branchId: 'b1',
      targetKind: 'character_relationship',
      targetId: 'rel_2',
      field: 'kind',
      language: 'cs',
      translatedText: 'y',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(await remove('char_x')).toMatchObject({ status: 'ok' })
    expect(
      await ctx.db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.id, 'rel_2')),
    ).toEqual([])
    expect(await ctx.db.select().from(translations).where(eq(translations.id, 'tr_3'))).toEqual([])

    const rows = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.actionId, 'act_del'))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(rows, ctx)

    expect(
      await ctx.db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.id, 'rel_2')),
    ).toHaveLength(1)
    expect(
      await ctx.db.select().from(translations).where(eq(translations.id, 'tr_3')),
    ).toHaveLength(1)
  })

  it('scopes the lead lookup to the target branch, ignoring another story that claims char_x as lead', async () => {
    // s2/b3's lead really is char_x; b1's is char_lead — dropping the branch filter on the lead
    // lookup would read whichever row the unfiltered join returns first, not the target's own.
    await ctx.db.insert(stories).values({
      id: 's2',
      title: 'T2',
      definition: { leadEntityId: 'char_x' } as StoryDefinition,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert(branches).values({ id: 'b3', storyId: 's2', name: 'm3', createdAt: 1 })
    await ctx.db.insert(entities).values(character('char_x', 'b3', 'Mira'))

    expect(await remove('char_x', 'b1')).toMatchObject({ status: 'ok' })
    expect(await remove('char_x', 'b3')).toMatchObject({
      status: 'rejected',
      code: ENTITY_DELETE_REJECTION.leadEntity,
    })
  })
})
