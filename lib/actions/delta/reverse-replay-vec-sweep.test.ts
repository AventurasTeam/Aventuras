import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { branches, ensureVecTablesSql, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { reverseAndPruneDeltaRows } from './reverse-replay'

function insertEntity(db: any, branchId: string, id: string): Promise<void> {
  return db.insert(entities).values({
    id,
    branchId,
    kind: 'character',
    name: 'Aria',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
}

function insertVector(sqlite: DatabaseSync, branchId: string, dim: number, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${branchId}:${id}:m${dim}`,
      branchId,
      `m${dim}`,
      id,
      'h',
      new Uint8Array(new Float32Array(dim).buffer),
    )
}

describe('reverse-replay of a create', () => {
  it("sweeps the deleted row's vectors from every dim family", async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await insertEntity(db, 'b1', 'char_1')
    for (const dim of [384, 8]) {
      insertVector(sqlite, 'b1', dim, 'char_1')
    }

    await reverseAndPruneDeltaRows(
      [
        {
          id: 'delta_1',
          branchId: 'b1',
          entryId: null,
          actionId: 'act_1',
          logPosition: 1,
          source: 'periodic_classifier',
          targetTable: 'entities',
          targetId: 'char_1',
          op: 'create',
          undoPayload: null,
          encodingVersion: 1,
          createdAt: 1,
        },
      ],
      { db, runInTransaction },
    )

    const left = sqlite
      .prepare(
        `SELECT (SELECT count(*) FROM entities_vec_384) + (SELECT count(*) FROM entities_vec_8) AS n`,
      )
      .all() as { n: number }[]
    expect(left[0].n).toBe(0)
  })

  it('leaves vectors with same id in other branches', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm', createdAt: 1 })
    await insertEntity(db, 'b1', 'char_1')
    await insertEntity(db, 'b2', 'char_1')
    insertVector(sqlite, 'b1', 8, 'char_1')
    insertVector(sqlite, 'b2', 8, 'char_1')

    await reverseAndPruneDeltaRows(
      [
        {
          id: 'delta_1',
          branchId: 'b1',
          entryId: null,
          actionId: 'act_1',
          logPosition: 1,
          source: 'periodic_classifier',
          targetTable: 'entities',
          targetId: 'char_1',
          op: 'create',
          undoPayload: null,
          encodingVersion: 1,
          createdAt: 1,
        },
      ],
      { db, runInTransaction },
    )

    const b1Count = sqlite
      .prepare(`SELECT count(*) AS n FROM entities_vec_8 WHERE branch_id = 'b1'`)
      .all() as { n: number }[]
    const b2Count = sqlite
      .prepare(`SELECT count(*) AS n FROM entities_vec_8 WHERE branch_id = 'b2'`)
      .all() as { n: number }[]
    expect(b1Count[0].n).toBe(0)
    expect(b2Count[0].n).toBe(1)
  })
})
