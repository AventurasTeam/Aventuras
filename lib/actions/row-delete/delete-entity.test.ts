import type { DatabaseSync } from 'node:sqlite'

import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  storyEntries,
  translations,
  type CharacterState,
  type Delta,
  type EntryMetadata,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { applyRedo, snapshotForRedo } from '../delta/redo'
import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { deleteEntityRow } from './delete-entity'

let ctx: DbCtx
let sqlite: DatabaseSync

const character = (id: string, name: string, state: Partial<CharacterState> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  state: { ...emptyEntityState('character'), ...state },
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

function insertVectors(): void {
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
}

function vectorCount(): number {
  const rows = sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM entities_vec_384 WHERE id = 'char_x') + (SELECT count(*) FROM entities_vec_8 WHERE id = 'char_x') AS n`,
    )
    .all() as { n: number }[]
  return rows[0].n
}

beforeEach(async () => {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  sqlite = test.sqlite
  for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
  const db = ctx.db
  await db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: 'char_lead' } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db
    .insert(entities)
    .values([
      character('char_lead', 'Kael'),
      character('char_x', 'Mira'),
      character('char_o', 'Vorne', { current_location_id: 'char_x', inventory: ['char_x'] }),
    ])
  await db.insert(happenings).values([
    { id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 },
    { id: 'hap_2', branchId: 'b1', title: 'Flood', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(happeningAwareness).values([
    { id: 'haw_1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_x' },
    { id: 'haw_2', branchId: 'b1', happeningId: 'hap_2', characterId: 'char_x' },
  ])
  await db
    .insert(happeningInvolvements)
    .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_x' })
  await db.insert(characterRelationships).values({
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_o',
    bId: 'char_x',
    kind: 'rival',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(translations).values({
    id: 'tr_1',
    branchId: 'b1',
    targetKind: 'entity',
    targetId: 'char_x',
    field: 'name',
    language: 'cs',
    translatedText: 'x',
    createdAt: 1,
    updatedAt: 1,
  })
  const scene: EntryMetadata = {
    sceneEntities: ['char_x', 'char_o'],
    currentLocationId: null,
    worldTime: 0,
  } as EntryMetadata
  await db.insert(storyEntries).values([
    {
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'Once.',
      metadata: scene,
      createdAt: 1,
    },
    {
      id: 'entry_2',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply',
      content: 'Then.',
      metadata: scene,
      createdAt: 2,
    },
  ])
  insertVectors()
  entitiesStore.hydrate('b1', (await db.select().from(entities)) as never)
})

async function otherState(): Promise<CharacterState> {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_o'))
  return row.state as CharacterState
}

async function tailScene(): Promise<readonly string[]> {
  const [row] = await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_2'))
  return (row.metadata as EntryMetadata).sceneEntities
}

async function linkCounts() {
  return {
    awareness: (await ctx.db.select().from(happeningAwareness)).length,
    involvements: (await ctx.db.select().from(happeningInvolvements)).length,
    relationships: (await ctx.db.select().from(characterRelationships)).length,
    translations: (await ctx.db.select().from(translations)).length,
  }
}

describe('deleteEntityRow — C3 acceptance', () => {
  it('deletes the cascade, rewrites refs in one update, drops the tail mention, sweeps vectors, under one action_id', async () => {
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toEqual([])
    expect(await linkCounts()).toEqual({
      awareness: 0,
      involvements: 0,
      relationships: 0,
      translations: 0,
    })
    expect(await otherState()).toMatchObject({ current_location_id: null, inventory: [] })
    expect(await tailScene()).toEqual(['char_o'])
    expect(vectorCount()).toBe(0)

    const rows = (await ctx.db.select().from(deltas)) as Delta[]
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
    expect(
      rows.filter((r) => r.targetTable === 'entities' && r.targetId === 'char_o'),
    ).toHaveLength(1)
  })

  it('undo restores everything stale; redo re-deletes and re-sweeps', async () => {
    await deleteEntityRow('b1', 'char_x', ctx)
    const rows = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    const snapshot = await snapshotForRedo(rows, ctx)
    await reverseAndPruneDeltaRows(rows, ctx)

    const [restored] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))
    expect(restored.embeddingStale).toBe(1)
    expect(await linkCounts()).toEqual({
      awareness: 2,
      involvements: 1,
      relationships: 1,
      translations: 1,
    })
    expect(await otherState()).toMatchObject({
      current_location_id: 'char_x',
      inventory: ['char_x'],
    })
    expect(await tailScene()).toEqual(['char_x', 'char_o'])

    insertVectors()
    await applyRedo(snapshot, ctx)
    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toEqual([])
    expect(await linkCounts()).toEqual({
      awareness: 0,
      involvements: 0,
      relationships: 0,
      translations: 0,
    })
    expect(vectorCount()).toBe(0)
  })

  it('refuses the lead with lead-entity and writes nothing', async () => {
    expect(await deleteEntityRow('b1', 'char_lead', ctx)).toMatchObject({
      status: 'rejected',
      code: 'lead-entity',
    })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('leaves no orphan when a classifier pass writes after the delete', async () => {
    await deleteEntityRow('b1', 'char_x', ctx)
    const awareness = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: { branchId: 'b1', characterId: 'char_x', happeningId: 'hap_1' },
        },
        actionId: 'act_pass',
        branchId: 'b1',
      },
      ctx,
    )
    const relationship = await applyDeltaAction(
      {
        action: {
          kind: 'upsertCharacterRelationship',
          source: 'periodic_classifier',
          payload: {
            branchId: 'b1',
            subjectId: 'char_lead',
            objectId: 'char_x',
            kind: 'friend',
            proseEntryId: null,
          },
        },
        actionId: 'act_pass',
        branchId: 'b1',
      },
      ctx,
    )
    expect(awareness).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(relationship).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await linkCounts()).toMatchObject({ awareness: 0, relationships: 0 })
  })
})
