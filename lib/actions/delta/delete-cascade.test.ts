import type { DatabaseSync } from 'node:sqlite'

import { eq } from 'drizzle-orm'
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

  it('discovers dim families created after the first call', async () => {
    const { db, sqlite, ctx } = await setup()
    await db.insert(stories).values({ id: 's2', title: 'T2', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b2', storyId: 's2', name: 'm', createdAt: 1 })
    const lister1 = vecTableLister(ctx)
    await lister1() // Consume once to seed the memo

    // Create a new dim family and insert a vector
    for (const ddl of ensureVecTablesSql(16)) sqlite.exec(ddl)
    insertVector(sqlite, 'entities_vec_16', 16, 'char_3')

    // A fresh lister discovers the new family
    const lister2 = vecTableLister(ctx)
    await ctx.runInTransaction(await vecSweepOps('entities', 'b1', 'char_3', lister2))

    const left = sqlite.prepare('SELECT count(*) AS n FROM entities_vec_16').all() as {
      n: number
    }[]
    expect(left[0].n).toBe(0)
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
      .where(eq(translations.branchId, 'b1'))
    expect(left.map((r) => r.id).sort()).toEqual(['tr_2', 'tr_3'])
  })

  it('reads nothing and writes nothing for an empty target list', async () => {
    const { ctx } = await setup()
    expect(await translationCascade(ctx, 'b1', [{ kind: 'lore', ids: [] }])).toEqual({
      ops: [],
      children: { translations: [] },
    })
  })

  it("scopes reads and deletes to the target branch, leaving another branch's same-id rows", async () => {
    const { db, sqlite, ctx } = await setup()
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm2', createdAt: 1 })

    const row = (branchId: string) => ({
      id: 'tr_1',
      branchId,
      targetKind: 'lore' as const,
      targetId: 'lore_1',
      field: 'title',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(translations).values([row('b1'), row('b2')])

    const insertLoreVector = (branchId: string) =>
      sqlite
        .prepare(
          `INSERT INTO lore_vec_8 (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `${branchId}:lore_1:m8`,
          branchId,
          'm8',
          'lore_1',
          'h',
          new Uint8Array(new Float32Array(8).buffer),
        )
    insertLoreVector('b1')
    insertLoreVector('b2')

    const cascade = await translationCascade(ctx, 'b1', [{ kind: 'lore', ids: ['lore_1'] }])
    const vecOps = await vecSweepOps('lore', 'b1', 'lore_1', vecTableLister(ctx))
    await ctx.runInTransaction([...cascade.ops, ...vecOps])

    expect(cascade.children.translations.map((r) => r.branchId)).toEqual(['b1'])
    const leftTranslations = await db.select({ branchId: translations.branchId }).from(translations)
    expect(leftTranslations.map((r) => r.branchId)).toEqual(['b2'])
    const leftVectors = sqlite.prepare('SELECT branch_id FROM lore_vec_8').all() as {
      branch_id: string
    }[]
    expect(leftVectors.map((r) => r.branch_id)).toEqual(['b2'])
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
