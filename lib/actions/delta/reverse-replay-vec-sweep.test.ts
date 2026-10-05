import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  branches,
  ensureVecTablesSql,
  entities,
  lore,
  sourceHash,
  stories,
  type Delta,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'

import { reverseRows } from './__tests__/reverse-rows'
import { buildReverseAndPrunePlan } from './reverse-replay'
import { selectReversalSet } from './row-closure'

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

function insertVector(
  sqlite: DatabaseSync,
  branchId: string,
  dim: number,
  id: string,
  kind: VecTargetKind = 'entity',
): void {
  plantVec(sqlite, {
    kind,
    id,
    branchId,
    modelId: `m${dim}`,
    dim,
    sourceHash: sourceHash('h'),
    vector: new Uint8Array(new Float32Array(dim).buffer),
  })
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
    const vectorCount = (): number =>
      (
        sqlite
          .prepare(
            `SELECT (SELECT count(*) FROM entities_vec_384) + (SELECT count(*) FROM entities_vec_8) AS n`,
          )
          .all() as { n: number }[]
      )[0].n
    expect(vectorCount()).toBe(2)

    await reverseRows(
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

    expect(vectorCount()).toBe(0)
  })

  it('sweeps several created rows with one statement per family table', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'm', createdAt: 1 })
    const ids = ['char_1', 'char_2', 'char_3']
    for (const id of ids) await insertEntity(db, 'b1', id)
    await db.insert(lore).values({
      id: 'lore_1',
      branchId: 'b1',
      title: 'Vael',
      body: 'b',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    for (const dim of [384, 8]) {
      for (const id of ids) insertVector(sqlite, 'b1', dim, id)
      insertVector(sqlite, 'b1', dim, 'lore_1', 'lore')
    }
    insertVector(sqlite, 'b2', 8, 'char_1')
    const creates: Delta[] = [...ids, 'lore_1'].map((id, i) => ({
      id: `delta_${i}`,
      branchId: 'b1',
      entryId: null,
      actionId: 'act_1',
      logPosition: 10 - i,
      source: 'periodic_classifier',
      targetTable: id.startsWith('lore') ? 'lore' : 'entities',
      targetId: id,
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    }))
    const ctx = { db, runInTransaction }

    const plan = await buildReverseAndPrunePlan(
      await selectReversalSet(ctx, { branchId: 'b1', target: creates }),
      ctx,
      { keepRedoExact: false },
    )
    const sweeps = plan.ops.map((op) => op.sql).filter((sql) => /_vec_\d+ WHERE/.test(sql))
    expect(sweeps.map((sql) => sql.split(' WHERE')[0]).sort()).toEqual([
      'DELETE FROM entities_vec_384',
      'DELETE FROM entities_vec_8',
      'DELETE FROM lore_vec_384',
      'DELETE FROM lore_vec_8',
    ])

    await reverseRows(creates, ctx)
    const left = sqlite
      .prepare(
        `SELECT branch_id, id FROM entities_vec_384 UNION ALL SELECT branch_id, id FROM entities_vec_8
         UNION ALL SELECT branch_id, id FROM lore_vec_384 UNION ALL SELECT branch_id, id FROM lore_vec_8`,
      )
      .all()
    expect(left).toEqual([{ branch_id: 'b2', id: 'char_1' }])
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

    await reverseRows(
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
