import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SqlOp } from '../types'
import { deleteVecOps, upsertVecOps } from './ops'
import { ensureVecTables } from './vec-tables'

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
    runOps(db, upsertVecOps({ ...base, sourceHash: 'h1', vector: vec(384, 0) }))
    runOps(db, upsertVecOps({ ...base, sourceHash: 'h2', vector: vec(384, 1) }))

    const rows = db
      .prepare('select id, source_hash from entities_vec_384 where branch_id = ?')
      .all('b1') as { id: string; source_hash: string }[]

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('e1')
    expect(rows[0].source_hash).toBe('h2')
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
        sourceHash: 'h1',
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
        sourceHash: 'h-other',
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

  it('deletes the row for (kind, id, branchId)', () => {
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: 'h1',
        vector: vec(384, 0),
      }),
    )
    runOps(db, deleteVecOps('entity', 384, 'e1', 'b1'))

    const rows = db.prepare('select id from entities_vec_384 where branch_id = ?').all('b1')
    expect(rows).toHaveLength(0)
  })
})
