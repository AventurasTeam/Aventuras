import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import { vecCopyStatement } from './vec-copy'
import { runOps } from '../__tests__/test-db'
import { ensureVecTablesSql, vecRowPk } from '../embeddings/vec-tables'

const VEC = 'entities_vec_4'
const SOURCE = 'entities'
const A = 'br_a'
const B = 'br_b'
const OTHER = 'br_other'

type VecRow = {
  pk: string
  branch_id: string
  model_id: string
  id: string
  source_hash: string
  embedding: Uint8Array
}

function vector(...values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer)
}

// e2's key predates the model segment; e3's source row is on A alone; OTHER's e1 is another
// branch's vector for an id B holds.
const SEEDED: VecRow[] = [
  {
    pk: 'br_a:e1:m1',
    branch_id: A,
    model_id: 'm1',
    id: 'e1',
    source_hash: 'h_e1',
    embedding: vector(1, 0, 0, 0),
  },
  {
    pk: 'br_a:e2',
    branch_id: A,
    model_id: 'm2',
    id: 'e2',
    source_hash: 'h_e2',
    embedding: vector(0, 1, 0, 0),
  },
  {
    pk: 'br_a:e3:m1',
    branch_id: A,
    model_id: 'm1',
    id: 'e3',
    source_hash: 'h_e3',
    embedding: vector(0, 0, 1, 0),
  },
  {
    pk: 'br_other:e1:m3',
    branch_id: OTHER,
    model_id: 'm3',
    id: 'e1',
    source_hash: 'h_o1',
    embedding: vector(0, 0, 0, 1),
  },
]

const SOURCE_ROWS: [branchId: string, id: string][] = [
  [A, 'e1'],
  [A, 'e2'],
  [A, 'e3'],
  [B, 'e1'],
  [B, 'e2'],
  [OTHER, 'e1'],
]

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  for (const ddl of ensureVecTablesSql(4)) db.exec(ddl)
  db.exec(`CREATE TABLE ${SOURCE} (branch_id TEXT NOT NULL, id TEXT NOT NULL)`)
  const insertVec = db.prepare(
    `INSERT INTO ${VEC} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const r of SEEDED) {
    insertVec.run(r.pk, r.branch_id, r.model_id, r.id, r.source_hash, r.embedding)
  }
  const insertSource = db.prepare(`INSERT INTO ${SOURCE} (branch_id, id) VALUES (?, ?)`)
  for (const [branchId, id] of SOURCE_ROWS) insertSource.run(branchId, id)
  return db
}

function partition(db: DatabaseSync, branchId: string): VecRow[] {
  return db
    .prepare(
      `SELECT pk, branch_id, model_id, id, source_hash, embedding FROM ${VEC}
        WHERE branch_id = ? ORDER BY id, model_id`,
    )
    .all(branchId) as VecRow[]
}

describe('vecCopyStatement', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = makeDb()
  })

  function copy(): void {
    runOps(db, [vecCopyStatement({ vecTable: VEC, sourceTable: SOURCE }, { from: A, to: B })])
  }

  it("copies from's vectors whose source row to holds, keyed <to>:<id>:<model>, every other column as stored", () => {
    copy()

    expect(partition(db, B)).toEqual([
      {
        pk: 'br_b:e1:m1',
        branch_id: B,
        model_id: 'm1',
        id: 'e1',
        source_hash: 'h_e1',
        embedding: vector(1, 0, 0, 0),
      },
      {
        pk: 'br_b:e2:m2',
        branch_id: B,
        model_id: 'm2',
        id: 'e2',
        source_hash: 'h_e2',
        embedding: vector(0, 1, 0, 0),
      },
    ])
  })

  it('keys every copy as vecRowPk does, the pre-widen row included', () => {
    copy()

    expect(partition(db, B).map((r) => r.pk)).toEqual([
      vecRowPk(B, 'e1', 'm1'),
      vecRowPk(B, 'e2', 'm2'),
    ])
  })

  it('leaves behind a vector whose source row to lacks', () => {
    copy()

    expect(partition(db, B).map((r) => r.id)).toEqual(['e1', 'e2'])
  })

  it("copies from's partition only, never another branch's vector for an id to holds", () => {
    copy()

    expect(partition(db, B).map((r) => r.model_id)).toEqual(['m1', 'm2'])
    expect(partition(db, OTHER)).toEqual([SEEDED[3]])
  })

  it("leaves from's partition as it was", () => {
    const before = partition(db, A)

    copy()

    expect(before).toHaveLength(3)
    expect(partition(db, A)).toEqual(before)
  })

  it("is found by a KNN on to's partition", () => {
    copy()

    const hits = db
      .prepare(
        `SELECT id, distance FROM ${VEC} WHERE embedding MATCH ? AND k = 3 AND branch_id = ?`,
      )
      .all(vector(1, 0, 0, 0), B) as { id: string; distance: number }[]

    expect(hits.map((h) => h.id).sort()).toEqual(['e1', 'e2'])
    expect(hits.find((h) => h.id === 'e1')?.distance).toBe(0)
  })

  it.each([
    [
      'a second statement',
      { vecTable: 'entities_vec_4; DROP TABLE entities', sourceTable: SOURCE },
    ],
    ['an aliased source', { vecTable: VEC, sourceTable: 'entities s' }],
    ['a quoted name', { vecTable: '"entities_vec_4"', sourceTable: SOURCE }],
    ['a leading digit', { vecTable: VEC, sourceTable: '4entities' }],
    ['an empty name', { vecTable: '', sourceTable: SOURCE }],
  ])('refuses %s spliced in as a table name', (_label, tables) => {
    expect(() => vecCopyStatement(tables, { from: A, to: B })).toThrow(/not a plain SQL identifier/)
  })
})
