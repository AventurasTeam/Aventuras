import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SqlOp } from '../types'
import { upsertVecOps } from './ops'
import { compositeText, sourceHash } from './source-hash'
import { recomputeStaleOp } from './stale'

const MIGRATIONS_DIR = 'lib/db/migrations'

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

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  for (const tag of migrationTags()) applyMigration(db, tag)
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

async function queryOneFor(db: DatabaseSync) {
  return async (sql: string, params: unknown[]) =>
    db.prepare(sql).get(...(params as SQLInputValue[])) as Record<string, unknown> | undefined
}

function embeddingStaleOf(db: DatabaseSync, id: string): number {
  const row = db.prepare('select embedding_stale from entities where id = ?').get(id) as {
    embedding_stale: number
  }
  return row.embedding_stale
}

describe('recomputeStaleOp', () => {
  let db: DatabaseSync
  const now = Date.now()

  beforeEach(() => {
    db = makeDb()
    db.prepare(`insert into stories (id, title, created_at, updated_at) values (?, ?, ?, ?)`).run(
      's1',
      'Story',
      now,
      now,
    )
    db.prepare(`insert into branches (id, story_id, name, created_at) values (?, ?, ?, ?)`).run(
      'b1',
      's1',
      'main',
      now,
    )
    db.prepare(
      `insert into entities (id, branch_id, kind, name, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, 'character', ?, 'active', 'always', 0, ?, ?)`,
    ).run('e1', 'b1', 'Kara', now, now)
  })

  it('flags dirty when no vec row exists yet (create has no vector)', async () => {
    const op = await recomputeStaleOp(
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
      384,
      'm1',
      await queryOneFor(db),
    )
    db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('flags dirty when current content hash differs from the stored vec-row source_hash', async () => {
    const embeddedHash = sourceHash(compositeText(['Kara', 'a scout']))
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: embeddedHash,
        vector: vec(384, 0),
      }),
    )

    const op = await recomputeStaleOp(
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a veteran scout'] },
      384,
      'm1',
      await queryOneFor(db),
    )
    db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('flags dirty when the stored vec row belongs to a different model', async () => {
    const embeddedHash = sourceHash(compositeText(['Kara', 'a scout']))
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: embeddedHash,
        vector: vec(384, 0),
      }),
    )

    const op = await recomputeStaleOp(
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
      384,
      'm2',
      await queryOneFor(db),
    )
    db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('revalidates to 0 (no re-embed) when content reverts to the embedded value', async () => {
    const embeddedHash = sourceHash(compositeText(['Kara', 'a scout']))
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id: 'e1',
        branchId: 'b1',
        modelId: 'm1',
        dim: 384,
        sourceHash: embeddedHash,
        vector: vec(384, 0),
      }),
    )
    db.prepare('update entities set embedding_stale = 1 where id = ?').run('e1')

    const op = await recomputeStaleOp(
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
      384,
      'm1',
      await queryOneFor(db),
    )
    db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    expect(embeddingStaleOf(db, 'e1')).toBe(0)
  })
})
