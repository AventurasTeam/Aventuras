import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = 'lib/db/migrations'

const VEC_TABLES_384 = [
  'entities_vec_384',
  'lore_vec_384',
  'happenings_vec_384',
  'threads_vec_384',
  'chapter_summaries_vec_384',
]

function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag)
}

function applyMigration(sqlite: DatabaseSync, tag: string): void {
  const sql = readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) sqlite.exec(trimmed)
  }
}

function vec(dim: number, seed: number): Buffer {
  const arr = new Float32Array(dim)
  arr[seed % dim] = 1
  return Buffer.from(arr.buffer)
}

describe('0005_embedder_vec0', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = new DatabaseSync(':memory:', { allowExtension: true })
    db.loadExtension(getLoadablePath())
    for (const tag of migrationTags()) applyMigration(db, tag)
  })

  it('creates the five 384-dim vec0 tables', () => {
    const names = (
      db
        .prepare("select name from sqlite_master where type = 'table' and name like '%_vec_384'")
        .all() as { name: string }[]
    ).map((r) => r.name)
    expect(names.sort()).toEqual([...VEC_TABLES_384].sort())
  })

  it('round-trips insert + KNN with branch partition and aux source_hash', () => {
    const ins = db.prepare(
      'insert into entities_vec_384(pk, branch_id, model_id, id, source_hash, embedding) values (?,?,?,?,?,?)',
    )
    ins.run('b1:e1', 'b1', 'm1', 'e1', 'h1', vec(384, 0))
    ins.run('b2:e2', 'b2', 'm1', 'e2', 'h2', vec(384, 1))
    const rows = db
      .prepare(
        'select id, source_hash, distance from entities_vec_384 where embedding match ? and k = 5 and branch_id = ?',
      )
      .all(vec(384, 0), 'b1') as { id: string; source_hash: string; distance: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('e1')
    expect(rows[0].source_hash).toBe('h1')
  })

  it('accepts the same source id copied into a different branch partition (fork-copy shape)', () => {
    const ins = db.prepare(
      'insert into lore_vec_384(pk, branch_id, model_id, id, source_hash, embedding) values (?,?,?,?,?,?)',
    )
    expect(() => {
      ins.run('b1:lo1', 'b1', 'm1', 'lo1', 'h1', vec(384, 0))
      ins.run('b2:lo1', 'b2', 'm1', 'lo1', 'h1', vec(384, 0))
    }).not.toThrow()
    const rows = db.prepare('select pk from lore_vec_384 order by pk').all() as { pk: string }[]
    expect(rows.map((r) => r.pk)).toEqual(['b1:lo1', 'b2:lo1'])
  })

  it('is idempotent — re-running the DDL does not throw', () => {
    expect(() => applyMigration(db, '0005_embedder_vec0')).not.toThrow()
    const source = readFileSync(`${MIGRATIONS_DIR}/0005_embedder_vec0.sql`, 'utf8')
    expect(source).toContain('IF NOT EXISTS')
  })
})
