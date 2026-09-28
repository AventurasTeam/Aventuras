import type { DatabaseSync } from 'node:sqlite'

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, ensureVecTablesSql, stories, translations } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import {
  cascadePatches,
  payloadFromChildren,
  restoreChildren,
  translationCascade,
  vecSweepOps,
  vecTableLister,
} from './delete-cascade'

async function setup() {
  const { db, sqlite, runInTransaction } = await createTestDb()
  for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  return { db, sqlite, ctx: { db, runInTransaction } }
}

function insertVector(sqlite: DatabaseSync, table: string, dim: number, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO ${table} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`b1:${id}:m${dim}`, 'b1', `m${dim}`, id, 'h', new Uint8Array(new Float32Array(dim).buffer))
}

function vectorIds(sqlite: DatabaseSync): string[] {
  const rows = sqlite
    .prepare('SELECT id FROM entities_vec_384 UNION ALL SELECT id FROM entities_vec_8')
    .all() as { id: string }[]
  return rows.map((row) => row.id).sort()
}

describe('vecSweepOps', () => {
  it('removes one embedded row from every dim family and leaves its neighbours', async () => {
    const { sqlite, ctx } = await setup()
    insertVector(sqlite, 'entities_vec_384', 384, 'char_1')
    insertVector(sqlite, 'entities_vec_8', 8, 'char_1')
    insertVector(sqlite, 'entities_vec_8', 8, 'char_2')

    await ctx.runInTransaction(await vecSweepOps('entities', 'b1', 'char_1', vecTableLister(ctx)))

    expect(vectorIds(sqlite)).toEqual(['char_2'])
  })

  it('sweeps nothing for a table no embedding covers', async () => {
    const { ctx } = await setup()
    expect(await vecSweepOps('story_entries', 'b1', 'entry_1', vecTableLister(ctx))).toEqual([])
  })
})

describe('translationCascade', () => {
  it("reads and deletes only the named targets' translations", async () => {
    const { db, ctx } = await setup()
    const row = (id: string, targetKind: 'lore' | 'entity', targetId: string) => ({
      id,
      branchId: 'b1',
      targetKind,
      targetId,
      field: 'title',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(translations)
      .values([
        row('tr_1', 'lore', 'lore_1'),
        row('tr_2', 'lore', 'lore_2'),
        row('tr_3', 'entity', 'lore_1'),
      ])

    const cascade = await translationCascade(ctx, 'b1', [{ kind: 'lore', ids: ['lore_1'] }])
    await ctx.runInTransaction(cascade.ops)

    expect(cascade.children.translations.map((r) => r.id)).toEqual(['tr_1'])
    const left = await db
      .select({ id: translations.id })
      .from(translations)
      .where(and(eq(translations.branchId, 'b1')))
    expect(left.map((r) => r.id).sort()).toEqual(['tr_2', 'tr_3'])
  })

  it('reads nothing and writes nothing for an empty target list', async () => {
    const { ctx } = await setup()
    expect(await translationCascade(ctx, 'b1', [{ kind: 'lore', ids: [] }])).toEqual({
      ops: [],
      children: { translations: [] },
    })
  })
})

describe('cascade payload round trip', () => {
  it('keys children by their payload key and restores them by table', () => {
    const children = {
      happening_involvements: [{ id: 'hinv_1' }],
      translations: [{ id: 'tr_1' }],
    }
    const payload = payloadFromChildren(children)
    expect(payload).toEqual({ involvements: [{ id: 'hinv_1' }], translations: [{ id: 'tr_1' }] })

    const restored = restoreChildren(['happening_involvements', 'translations'])({
      id: 'x',
      ...payload,
    })
    expect(restored).toEqual({
      children: [
        { table: 'happening_involvements', rows: [{ id: 'hinv_1' }] },
        { table: 'translations', rows: [{ id: 'tr_1' }] },
      ],
      cascadeKeys: ['involvements', 'translations'],
    })
    expect(cascadePatches(children)).toEqual([
      { table: 'happening_involvements', patch: { op: 'delete', id: 'hinv_1' } },
      { table: 'translations', patch: { op: 'delete', id: 'tr_1' } },
    ])
  })
})
