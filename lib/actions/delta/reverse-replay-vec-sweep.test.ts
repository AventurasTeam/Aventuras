import { describe, expect, it } from 'vitest'

import { branches, ensureVecTablesSql, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { reverseAndPruneDeltaRows } from './reverse-replay'

describe('reverse-replay of a create', () => {
  it("sweeps the deleted row's vectors from every dim family", async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db
      .insert(entities)
      .values({
        id: 'char_1',
        branchId: 'b1',
        kind: 'character',
        name: 'Aria',
        status: 'active',
        injectionMode: 'auto',
        createdAt: 1,
        updatedAt: 1,
      })
    for (const dim of [384, 8]) {
      sqlite
        .prepare(
          `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `b1:char_1:m${dim}`,
          'b1',
          `m${dim}`,
          'char_1',
          'h',
          new Uint8Array(new Float32Array(dim).buffer),
        )
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
})
