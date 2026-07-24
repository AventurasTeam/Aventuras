import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SqlOp } from '../types'
import { deleteVecOps, upsertVecOps } from './ops'
import { sourceHash } from './source-hash'
import { deleteBranchModelVecOps, ensureVecTables, vecRowPk } from './vec-tables'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  return db
}

function runOps(db: DatabaseSync, ops: SqlOp[]): void {
  db.exec('BEGIN')
  try {
    for (const op of ops) {
      db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function vec(dim: number, seed: number): Uint8Array {
  const arr = new Float32Array(dim)
  arr[seed % dim] = 1
  return new Uint8Array(arr.buffer)
}

describe('upsertVecOps / deleteVecOps', () => {
  let db: DatabaseSync

  beforeEach(async () => {
    db = makeDb()
    await ensureVecTables(384, async (sql) => {
      db.exec(sql)
    })
  })

  it('upserting the same (id, branch_id) twice leaves exactly one row carrying the latest values', () => {
    const base = { kind: 'entity' as const, id: 'e1', branchId: 'b1', modelId: 'm1', dim: 384 }
    runOps(db, upsertVecOps({ ...base, sourceHash: sourceHash('h1'), vector: vec(384, 0) }))
    runOps(db, upsertVecOps({ ...base, sourceHash: sourceHash('h2'), vector: vec(384, 1) }))

    const rows = db
      .prepare('select id, source_hash from entities_vec_384 where branch_id = ?')
      .all('b1') as { id: string; source_hash: string }[]

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('e1')
    expect(rows[0].source_hash).toBe(sourceHash('h2'))
  })

  it('does not disturb a different id in the same branch', () => {
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h1'),
        vector: vec(384, 0),
      }),
    )
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e2',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h-other'),
        vector: vec(384, 1),
      }),
    )

    const rows = db.prepare('select id, source_hash from entities_vec_384 order by id').all() as {
      id: string
      source_hash: string
    }[]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id)).toEqual(['e1', 'e2'])
  })

  it('inserts cleanly when the same source id exists in a different branch, and branch_id-scoped KNN returns only that branch row', () => {
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h1'),
        vector: vec(384, 0),
      }),
    )
    expect(() =>
      runOps(
        db,
        upsertVecOps({
          kind: 'entity',
          id: 'e1',
          branchId: 'b2',
          modelId: 'm1',
          dim: 384,
          sourceHash: sourceHash('h2'),
          vector: vec(384, 1),
        }),
      ),
    ).not.toThrow()

    const rows = db
      .prepare('select pk, branch_id, id, source_hash from entities_vec_384 order by branch_id')
      .all() as { pk: string; branch_id: string; id: string; source_hash: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.pk)).toEqual(['b1:e1:m1', 'b2:e1:m1'])
    expect(rows.every((r) => r.id === 'e1')).toBe(true)

    const knnRows = db
      .prepare(
        'select id, source_hash, distance from entities_vec_384 where embedding match ? and k = 5 and branch_id = ?',
      )
      .all(vec(384, 0), 'b1') as { id: string; source_hash: string; distance: number }[]
    expect(knnRows).toHaveLength(1)
    expect(knnRows[0].id).toBe('e1')
    expect(knnRows[0].source_hash).toBe(sourceHash('h1'))
  })

  it('deletes the row for (kind, id, branchId)', () => {
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h1'),
        vector: vec(384, 0),
      }),
    )
    runOps(db, deleteVecOps('entity', 'e1', 'b1', ['entities_vec_384']))

    const rows = db.prepare('select id from entities_vec_384 where branch_id = ?').all('b1')
    expect(rows).toHaveLength(0)
  })

  it('matches a legacy 2-part-pk row by columns: upsert of the same model replaces it', () => {
    db.prepare(
      'insert into entities_vec_384 (pk, branch_id, model_id, id, source_hash, embedding) values (?, ?, ?, ?, ?, ?)',
    ).run('b1:e1', 'b1', 'm1', 'e1', sourceHash('legacy'), vec(384, 0))

    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h-new'),
        vector: vec(384, 1),
      }),
    )

    const rows = db
      .prepare('select pk, source_hash from entities_vec_384 where branch_id = ?')
      .all('b1') as { pk: string; source_hash: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].pk).toBe('b1:e1:m1')
    expect(rows[0].source_hash).toBe(sourceHash('h-new'))
  })

  it('matches a legacy 2-part-pk row by columns: deleteVecOps removes it', () => {
    db.prepare(
      'insert into entities_vec_384 (pk, branch_id, model_id, id, source_hash, embedding) values (?, ?, ?, ?, ?, ?)',
    ).run('b1:e2', 'b1', 'm1', 'e2', sourceHash('legacy'), vec(384, 0))

    runOps(db, deleteVecOps('entity', 'e2', 'b1', ['entities_vec_384']))

    const rows = db.prepare('select id from entities_vec_384 where branch_id = ?').all('b1')
    expect(rows).toHaveLength(0)
  })

  it('upserting a second model for the same (branch, id) leaves both rows, and does not disturb the first model row', () => {
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: sourceHash('h1'),
        vector: vec(384, 0),
      }),
    )
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm2',
        dim: 384,
        sourceHash: sourceHash('h2'),
        vector: vec(384, 1),
      }),
    )

    const rows = db
      .prepare(
        'select pk, model_id, source_hash from entities_vec_384 where branch_id = ? order by pk',
      )
      .all('b1') as { pk: string; model_id: string; source_hash: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.pk)).toEqual(['b1:e1:m1', 'b1:e1:m2'])

    const m1Row = rows.find((r) => r.model_id === 'm1')
    expect(m1Row?.source_hash).toBe(sourceHash('h1'))
  })
})

describe('model-aware vec identity', () => {
  it('pk carries the model id', () => {
    expect(vecRowPk('b1', 'e1', 'm1')).toBe('b1:e1:m1')
  })

  it('upsert replaces only the same model row', () => {
    const [del, ins] = upsertVecOps({
      kind: 'entity',
      id: 'e1',
      branchId: 'b1',
      modelId: 'm2',
      dim: 384,
      sourceHash: 'h' as never,
      vector: new Uint8Array(4),
    })
    expect(del.sql).toBe(
      'DELETE FROM entities_vec_384 WHERE branch_id = ? AND id = ? AND model_id = ?',
    )
    expect(del.params).toEqual(['b1', 'e1', 'm2'])
    expect(ins.params[0]).toBe('b1:e1:m2')
  })

  it('deleteVecOps sweeps every existing family of the kind by columns', () => {
    const tables = ['entities_vec_384', 'entities_vec_768', 'lore_vec_384', 'entities_vec_384_info']
    const ops = deleteVecOps('entity', 'e1', 'b1', tables)
    expect(ops.map((o) => o.sql)).toEqual([
      'DELETE FROM entities_vec_384 WHERE branch_id = ? AND id = ?',
      'DELETE FROM entities_vec_768 WHERE branch_id = ? AND id = ?',
    ])
  })

  it('deleteBranchModelVecOps deletes one model across all families', () => {
    const ops = deleteBranchModelVecOps(['entities_vec_384', 'lore_vec_768'], ['b1', 'b2'], 'm1')
    expect(ops[0].sql).toBe(
      'DELETE FROM entities_vec_384 WHERE branch_id IN (?, ?) AND model_id = ?',
    )
    expect(ops[0].params).toEqual(['b1', 'b2', 'm1'])
    expect(ops).toHaveLength(2)
  })
})
