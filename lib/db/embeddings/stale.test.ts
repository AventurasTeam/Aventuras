import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SqlOp } from '../types'
import { upsertVecOps } from './ops'
import { compositeText, sourceHash } from './source-hash'
import { clearEmbeddingStaleOp, flagEmbeddingStaleOps, recomputeStaleOps } from './stale'
import { ensureVecTablesSql } from './vec-tables'

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

function queryAllFor(db: DatabaseSync) {
  return async (sql: string, params: unknown[]) =>
    (db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[]).map((row) =>
      Object.values(row),
    )
}

function tableNamesOf(db: DatabaseSync): string[] {
  return (
    db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
  ).map((row) => row.name)
}

function embeddingStaleOf(db: DatabaseSync, id: string): number {
  const row = db.prepare('select embedding_stale from entities where id = ?').get(id) as {
    embedding_stale: number
  }
  return row.embedding_stale
}

describe('recomputeStaleOps', () => {
  let db: DatabaseSync
  const now = Date.now()

  const entity = (id: string, fields: (string | null)[]) => ({
    kind: 'entity' as const,
    id,
    branchId: 'b1',
    fields,
  })

  const recompute = (rows: ReturnType<typeof entity>[], modelId: string) =>
    recomputeStaleOps(rows, modelId, tableNamesOf(db), queryAllFor(db))

  function seedVector(id: string, fields: (string | null)[], modelId: string, dim = 384): void {
    for (const sql of ensureVecTablesSql(dim)) db.exec(sql)
    runOps(
      db,
      upsertVecOps({
        kind: 'entity',
        id,
        branchId: 'b1',
        modelId,
        dim,
        sourceHash: sourceHash(compositeText(fields)),
        vector: vec(dim, 0),
      }),
    )
  }

  function insertEntity(id: string, name: string): void {
    db.prepare(
      `insert into entities (id, branch_id, kind, name, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, 'character', ?, 'active', 'always', 0, ?, ?)`,
    ).run(id, 'b1', name, now, now)
  }

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
    insertEntity('e1', 'Kara')
  })

  it('flags dirty when no vec row exists yet (create has no vector)', async () => {
    runOps(db, await recompute([entity('e1', ['Kara', 'a scout'])], 'm1'))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('flags dirty when current content hash differs from the stored vec-row source_hash', async () => {
    seedVector('e1', ['Kara', 'a scout'], 'm1')
    runOps(db, await recompute([entity('e1', ['Kara', 'a veteran scout'])], 'm1'))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('flags dirty when the stored vec row belongs to a different model', async () => {
    seedVector('e1', ['Kara', 'a scout'], 'm1')
    runOps(db, await recompute([entity('e1', ['Kara', 'a scout'])], 'm2'))
    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  it('revalidates to 0 (no re-embed) when content reverts to the embedded value', async () => {
    seedVector('e1', ['Kara', 'a scout'], 'm1')
    db.prepare('update entities set embedding_stale = 1 where id = ?').run('e1')
    runOps(db, await recompute([entity('e1', ['Kara', 'a scout'])], 'm1'))
    expect(embeddingStaleOf(db, 'e1')).toBe(0)
  })

  it('finds the stored vector whatever dim family it landed in', async () => {
    // A cross-model cancel cannot know the old family's dim — a provider's native
    // dim is only learned from a response — so the model id has to locate it.
    seedVector('e1', ['Kara', 'a scout'], 'm1', 768)
    db.prepare('update entities set embedding_stale = 1 where id = ?').run('e1')
    runOps(db, await recompute([entity('e1', ['Kara', 'a scout'])], 'm1'))
    expect(embeddingStaleOf(db, 'e1')).toBe(0)
  })

  it('partitions a mixed set in one pass, clearing and flagging independently', async () => {
    insertEntity('e2', 'Bram')
    insertEntity('e3', 'Cass')
    seedVector('e1', ['Kara', 'a scout'], 'm1')
    seedVector('e2', ['Bram', 'a smith'], 'm1')
    // e3 never embedded. e2's content has since moved on.
    db.prepare('update entities set embedding_stale = 1 where id = ?').run('e1')

    runOps(
      db,
      await recompute(
        [
          entity('e1', ['Kara', 'a scout']),
          entity('e2', ['Bram', 'a master smith']),
          entity('e3', ['Cass', 'a rider']),
        ],
        'm1',
      ),
    )

    expect(embeddingStaleOf(db, 'e1')).toBe(0)
    expect(embeddingStaleOf(db, 'e2')).toBe(1)
    expect(embeddingStaleOf(db, 'e3')).toBe(1)
  })
})

describe('clearEmbeddingStaleOp', () => {
  let db: DatabaseSync
  const now = Date.now()

  const insert = (id: string, name: string, description: string | null) =>
    db
      .prepare(
        `insert into entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
         values (?, ?, 'character', ?, ?, 'active', 'always', 1, ?, ?)`,
      )
      .run(id, 'b1', name, description, now, now)

  const row = (id: string, fields: (string | null)[]) => ({
    kind: 'entity' as const,
    id,
    branchId: 'b1',
    fields,
  })

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
  })

  it('clears when the row still holds what was embedded', () => {
    insert('e1', 'Kara', 'a scout')

    runOps(db, [clearEmbeddingStaleOp(row('e1', ['Kara', 'a scout']))])

    expect(embeddingStaleOf(db, 'e1')).toBe(0)
  })

  // The lost update: a writer dirties the row between loadStaleRows reading it
  // and this commit. A blind clear leaves new text, an old vector and a clean
  // flag — permanently, since nothing re-derives the flag outside a swap.
  it('leaves the flag set when the row moved on after the embed read it', () => {
    insert('e1', 'Kara', 'a scout')
    db.prepare('update entities set description = ? where id = ?').run('a spy', 'e1')

    runOps(db, [clearEmbeddingStaleOp(row('e1', ['Kara', 'a scout']))])

    expect(embeddingStaleOf(db, 'e1')).toBe(1)
  })

  // `=` would make this comparison NULL rather than true, stranding every row
  // with an empty description dirty forever.
  it('clears a row whose embedded field is null', () => {
    insert('e2', 'Mara', null)

    runOps(db, [clearEmbeddingStaleOp(row('e2', ['Mara', null]))])

    expect(embeddingStaleOf(db, 'e2')).toBe(0)
  })

  it('does not clear a row on another branch that shares the id', () => {
    db.prepare(`insert into branches (id, story_id, name, created_at) values (?, ?, ?, ?)`).run(
      'b2',
      's1',
      'other',
      now,
    )
    insert('e1', 'Kara', 'a scout')
    db.prepare(
      `insert into entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, 'b2', 'character', ?, ?, 'active', 'always', 1, ?, ?)`,
    ).run('e1', 'Kara', 'a scout', now, now)

    runOps(db, [clearEmbeddingStaleOp(row('e1', ['Kara', 'a scout']))])

    const other = db
      .prepare('select embedding_stale from entities where id = ? and branch_id = ?')
      .get('e1', 'b2') as { embedding_stale: number }
    expect(other.embedding_stale).toBe(1)
  })
})

describe('flagEmbeddingStaleOps chunking', () => {
  it('splits past the SQLite variable floor instead of emitting one huge IN list', () => {
    const rows = Array.from({ length: 401 }, (_, i) => ({
      kind: 'entity' as const,
      id: `e${i}`,
      branchId: 'b1',
    }))

    const ops = flagEmbeddingStaleOps(rows)

    // 400 ids + the branch param is the ceiling; a single statement here would
    // blow the 999-variable limit on a large story's cancel and throw at commit.
    expect(ops).toHaveLength(2)
    expect(ops[0].params).toHaveLength(401)
    expect(ops[1].params).toHaveLength(2)
    expect(ops.flatMap((op) => op.params.slice(1))).toEqual(rows.map((row) => row.id))
  })
})
