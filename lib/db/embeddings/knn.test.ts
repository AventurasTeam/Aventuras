import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import { knnQuery, unpackFloat32 } from './knn'
import { packFloat32 } from './ops'
import { ensureVecTables } from './vec-tables'

const unit = (...xs: number[]): Float32Array => {
  const v = Float32Array.from(xs)
  const n = Math.hypot(...xs)
  return v.map((x) => x / n)
}

describe('unpackFloat32', () => {
  it('round-trips through packFloat32', () => {
    const v = unit(1, 2, 3)
    expect(Array.from(unpackFloat32(packFloat32(v)))).toEqual(Array.from(v))
  })

  // Buffer#slice returns a VIEW, not a copy, so a driver handing back a pooled
  // Buffer at an odd offset survives into the Float32Array construction and
  // throws RangeError unless the copy is unconditional.
  it('decodes a misaligned Buffer view rather than throwing', () => {
    const values = [0.5, -0.25, 0.75]
    const backing = new ArrayBuffer(16)
    const view = new DataView(backing)
    values.forEach((v, i) => view.setFloat32(3 + i * 4, v, true))

    const misaligned = Buffer.from(backing, 3, 12)
    expect(misaligned.byteOffset % 4).not.toBe(0)
    expect(Array.from(unpackFloat32(misaligned))).toEqual(values)
  })

  it('rejects a blob that is not a whole number of float32s', () => {
    expect(() => unpackFloat32(new Uint8Array(9))).toThrow(/Invalid vector blob length: 9/)
  })
})

describe('knnQuery', () => {
  it('binds MATCH, k, branch and model against the dim-suffixed table', () => {
    const q = knnQuery('lore', 384, {
      branchId: 'br_1',
      modelId: 'm',
      k: 200,
      vector: new Uint8Array(4),
    })
    expect(q.sql).toContain('FROM lore_vec_384')
    expect(q.sql).toContain('embedding MATCH ?')
    expect(q.sql).toContain('k = ?')
    expect(q.sql).toContain('branch_id = ?')
    expect(q.sql).toContain('model_id = ?')
    expect(q.params).toEqual([expect.any(Uint8Array), 200, 'br_1', 'm'])
  })

  it('selects the embedding so candidate vectors arrive with the match row', () => {
    const q = knnQuery('lore', 384, {
      branchId: 'br_1',
      modelId: 'm',
      k: 10,
      vector: new Uint8Array(4),
    })
    expect(q.sql).toContain('SELECT id, distance, embedding')
  })

  it.each([0, -1, 1.5])('rejects k = %s', (k) => {
    expect(() =>
      knnQuery('lore', 384, { branchId: 'br_1', modelId: 'm', k, vector: new Uint8Array(4) }),
    ).toThrow(/Invalid KNN k/)
  })
})

describe('knnQuery against a real DB', () => {
  const DIM = 4
  let db: DatabaseSync

  const vec = (...xs: number[]): Uint8Array => packFloat32(Float32Array.from(xs))

  const seed = (branchId: string, modelId: string, id: string, ...xs: number[]): void => {
    db.prepare(
      'insert into lore_vec_4 (pk, branch_id, model_id, id, source_hash, embedding) values (?, ?, ?, ?, ?, ?)',
    ).run(`${branchId}:${id}:${modelId}`, branchId, modelId, id, 'h', vec(...xs))
  }

  const run = (k: number) => {
    const { sql, params } = knnQuery('lore', DIM, {
      branchId: 'b1',
      modelId: 'm1',
      k,
      vector: vec(1, 0, 0, 0),
    })
    return db.prepare(sql).all(...(params as never[])) as {
      id: string
      distance: number
      embedding: Uint8Array
    }[]
  }

  beforeEach(async () => {
    db = new DatabaseSync(':memory:', { allowExtension: true })
    db.loadExtension(getLoadablePath())
    await ensureVecTables(DIM, async (sql) => {
      db.exec(sql)
    })
  })

  // Pins sqlite-vec's metric: a squared-L2 build returns 2 for the orthogonal
  // pair. Ordering is monotonic under either, so nothing else would notice.
  it('returns plain euclidean distance, not squared', () => {
    seed('b1', 'm1', 'same', 1, 0, 0, 0)
    seed('b1', 'm1', 'orthogonal', 0, 1, 0, 0)
    seed('b1', 'm1', 'opposed', -1, 0, 0, 0)

    const byId = Object.fromEntries(run(3).map((r) => [r.id, r.distance]))
    expect(byId.same).toBeCloseTo(0, 6)
    expect(byId.orthogonal).toBeCloseTo(Math.SQRT2, 6)
    expect(byId.opposed).toBeCloseTo(2, 6)
  })

  it('returns an embedding blob that unpacks to the seeded vector', () => {
    seed('b1', 'm1', 'l1', 0.5, -0.25, 0.75, 0)

    const [row] = run(1)
    expect(row.id).toBe('l1')
    expect(Array.from(unpackFloat32(row.embedding))).toEqual([0.5, -0.25, 0.75, 0])
  })

  // Decoys sit strictly nearer the query than every target, so a post-filter
  // (top-k first, filter after) would return fewer than k rows.
  it('applies the branch and model filters inside the search, not after it', () => {
    for (let i = 0; i < 6; i += 1) {
      seed('b2', 'm1', `wrong-branch-${i}`, 1, 0, 0, 0)
      seed('b1', 'm2', `wrong-model-${i}`, 1, 0, 0, 0)
    }
    for (let i = 0; i < 4; i += 1) seed('b1', 'm1', `target-${i}`, 0, 1, 0, 0)

    const rows = run(4)
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.id).sort()).toEqual(['target-0', 'target-1', 'target-2', 'target-3'])
  })

  it('limits to k when more rows match the filters', () => {
    for (let i = 0; i < 8; i += 1) seed('b1', 'm1', `l${i}`, 1, i / 10, 0, 0)

    expect(run(2)).toHaveLength(2)
    expect(run(5)).toHaveLength(5)
    expect(run(8)).toHaveLength(8)
  })
})
