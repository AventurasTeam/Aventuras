import type { DatabaseSync } from 'node:sqlite'

import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  chapters,
  deltas,
  ensureVecTablesSql,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  threads,
  translations,
  type Delta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningInvolvementsStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { applyRedo, snapshotForRedo } from './redo'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import type { DbCtx } from '../types'

let ctx: DbCtx
let sqlite: DatabaseSync

beforeEach(async () => {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  sqlite = test.sqlite
  for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
})

const CASES = [
  {
    kind: 'lore',
    family: 'lore_vec',
    translationKind: 'lore',
    insert: () =>
      ctx.db
        .insert(lore)
        .values({
          id: 'row_1',
          branchId: 'b1',
          title: 'Vael',
          body: 'b',
          injectionMode: 'auto',
          embeddingStale: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
    remove: { kind: 'deleteLore', source: 'user_edit', payload: { branchId: 'b1', id: 'row_1' } },
    select: () => ctx.db.select().from(lore),
  },
  {
    kind: 'thread',
    family: 'threads_vec',
    translationKind: 'thread',
    insert: () =>
      ctx.db
        .insert(threads)
        .values({
          id: 'row_1',
          branchId: 'b1',
          title: 'Debt',
          status: 'active',
          injectionMode: 'auto',
          embeddingStale: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
    remove: { kind: 'deleteThread', source: 'user_edit', payload: { branchId: 'b1', id: 'row_1' } },
    select: () => ctx.db.select().from(threads),
  },
  {
    kind: 'chapter',
    family: 'chapter_summaries_vec',
    translationKind: 'chapter',
    insert: () =>
      ctx.db
        .insert(chapters)
        .values({
          id: 'row_1',
          branchId: 'b1',
          sequenceNumber: 1,
          title: 'I',
          summary: 's',
          theme: 't',
          startEntryId: 'e1',
          endEntryId: 'e2',
          tokenCount: 1,
          closedAt: 1,
          embeddingStale: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
    remove: {
      kind: 'deleteChapter',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'row_1' },
    },
    select: () => ctx.db.select().from(chapters),
  },
  {
    kind: 'happening',
    family: 'happenings_vec',
    translationKind: 'happening',
    insert: () =>
      ctx.db
        .insert(happenings)
        .values({
          id: 'row_1',
          branchId: 'b1',
          title: 'Fire',
          embeddingStale: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
    remove: {
      kind: 'deleteHappening',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'row_1' },
    },
    select: () => ctx.db.select().from(happenings),
  },
] as const

function insertVectors(family: string): void {
  for (const dim of [384, 8]) {
    sqlite
      .prepare(
        `INSERT INTO ${family}_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `b1:row_1:m${dim}`,
        'b1',
        `m${dim}`,
        'row_1',
        'h',
        new Uint8Array(new Float32Array(dim).buffer),
      )
  }
}

function vectorCount(family: string): number {
  const rows = sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM ${family}_384 WHERE id = 'row_1') + (SELECT count(*) FROM ${family}_8 WHERE id = 'row_1') AS n`,
    )
    .all() as { n: number }[]
  return rows[0].n
}

async function groupRows(actionId: string): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

describe.each(CASES)('delete $kind', ({ family, translationKind, insert, remove, select }) => {
  it('sweeps its vectors and translations forward, restores the row stale on undo, sweeps again on redo', async () => {
    await insert()
    insertVectors(family)
    await ctx.db
      .insert(translations)
      .values({
        id: 'tr_1',
        branchId: 'b1',
        targetKind: translationKind,
        targetId: 'row_1',
        field: 'title',
        language: 'cs',
        translatedText: 'x',
        createdAt: 1,
        updatedAt: 1,
      })

    expect(
      await applyDeltaAction({ action: remove, actionId: 'act_del', branchId: 'b1' }, ctx),
    ).toMatchObject({ status: 'ok' })
    expect(await select()).toEqual([])
    expect(vectorCount(family)).toBe(0)
    expect(await ctx.db.select().from(translations)).toEqual([])

    const rows = await groupRows('act_del')
    const snapshot = await snapshotForRedo(rows, ctx)
    await reverseAndPruneDeltaRows(rows, ctx)
    const [restored] = await select()
    expect(restored?.embeddingStale).toBe(1)
    expect(await ctx.db.select().from(translations)).toHaveLength(1)

    insertVectors(family)
    await applyRedo(snapshot, ctx)
    expect(await select()).toEqual([])
    expect(vectorCount(family)).toBe(0)
    expect(await ctx.db.select().from(translations)).toEqual([])
  })
})

describe('delete happening — link rows', () => {
  it('removes its involvements from the store forward and restores them on undo', async () => {
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
    const involvement = {
      id: 'hinv_1',
      branchId: 'b1',
      happeningId: 'hap_1',
      entityId: 'char_a',
      role: null,
    }
    await ctx.db.insert(happeningInvolvements).values(involvement)
    await ctx.db
      .insert(happeningAwareness)
      .values({ id: 'haw_1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_a' })
    happeningInvolvementsStore.hydrate('b1', [involvement])

    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappening',
          source: 'user_edit',
          payload: { branchId: 'b1', id: 'hap_1' },
        },
        actionId: 'act_h',
        branchId: 'b1',
      },
      ctx,
    )
    expect(happeningInvolvementsStore.getInvolvements().has('hinv_1')).toBe(false)

    await reverseAndPruneDeltaRows(await groupRows('act_h'), ctx)
    expect(await ctx.db.select().from(happeningInvolvements)).toHaveLength(1)
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
    expect(happeningInvolvementsStore.getInvolvements().has('hinv_1')).toBe(true)
  })
})
