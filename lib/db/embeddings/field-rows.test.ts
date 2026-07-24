import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

import { branchRowsQuery, countStaleRows, staleRowsQuery, toEmbeddedFieldRow } from './field-rows'
import { createTestDb } from '../__tests__/test-db'

function rowsOf(db: DatabaseSync, sql: string, params: unknown[]): unknown[][] {
  return (db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[]).map(
    (row) => Object.values(row),
  )
}

function queryAllFor(db: DatabaseSync) {
  return async (sql: string, params: unknown[]) => rowsOf(db, sql, params)
}

describe('field-rows', () => {
  it('composes canon fields per kind', () => {
    expect(staleRowsQuery('entity', []).sql).toContain(
      'SELECT id, branch_id, name, description FROM entities',
    )
    expect(branchRowsQuery('lore', []).sql).toContain('SELECT id, branch_id, title, body FROM lore')
    expect(staleRowsQuery('happening', []).sql).toContain(
      'SELECT id, branch_id, title, description FROM happenings',
    )
    expect(branchRowsQuery('thread', []).sql).toContain(
      'SELECT id, branch_id, title, description FROM threads',
    )
    expect(staleRowsQuery('chapter', []).sql).toContain(
      'SELECT id, branch_id, summary, theme FROM chapters',
    )
  })

  it('staleRowsQuery filters embedding_stale = 1 within the branches', () => {
    const q = staleRowsQuery('entity', ['b1', 'b2'])
    expect(q.sql).toContain('embedding_stale = 1')
    expect(q.params).toEqual(['b1', 'b2'])
  })

  it('staleRowsQuery falls back to an always-false predicate for an empty branch set', () => {
    const q = staleRowsQuery('entity', [])
    expect(q.sql).toContain('WHERE 0')
    expect(q.sql).not.toContain('IN ()')
    expect(q.params).toEqual([])
  })

  it('branchRowsQuery falls back to an always-false predicate for an empty branch set', () => {
    const q = branchRowsQuery('entity', [])
    expect(q.sql).toContain('WHERE 0')
    expect(q.sql).not.toContain('IN ()')
    expect(q.params).toEqual([])
  })
})

describe('field-rows against a real DB', () => {
  let sqlite: DatabaseSync
  const now = Date.now()

  beforeEach(async () => {
    const testDb = await createTestDb()
    sqlite = testDb.sqlite
    sqlite
      .prepare(`insert into stories (id, title, created_at, updated_at) values (?, ?, ?, ?)`)
      .run('s1', 'Story', now, now)
    sqlite
      .prepare(`insert into branches (id, story_id, name, created_at) values (?, ?, ?, ?)`)
      .run('b1', 's1', 'main', now)
    sqlite
      .prepare(
        `insert into entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, 'character', ?, ?, 'active', 'always', 1, ?, ?)`,
      )
      .run('e1', 'b1', 'Kara', 'a scout', now, now)
    sqlite
      .prepare(
        `insert into lore (id, branch_id, title, body, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, ?, ?, 'always', 0, ?, ?)`,
      )
      .run('l1', 'b1', 'The Old War', 'A long time ago...', now, now)
  })

  it('countStaleRows totals and breaks down by kind', async () => {
    const result = await countStaleRows(queryAllFor(sqlite), ['b1'])
    expect(result).toEqual({
      total: 1,
      byKind: { entity: 1, lore: 0, happening: 0, thread: 0, chapter: 0 },
    })
  })

  it('countStaleRows returns all zeros without querying when branchIds is empty', async () => {
    const result = await countStaleRows(queryAllFor(sqlite), [])
    expect(result).toEqual({
      total: 0,
      byKind: { entity: 0, lore: 0, happening: 0, thread: 0, chapter: 0 },
    })
  })

  it('staleRowsQuery + toEmbeddedFieldRow maps the stale entity row', () => {
    const q = staleRowsQuery('entity', ['b1'])
    const rows = rowsOf(sqlite, q.sql, q.params)
    expect(rows).toHaveLength(1)
    expect(toEmbeddedFieldRow('entity', rows[0])).toEqual({
      kind: 'entity',
      id: 'e1',
      branchId: 'b1',
      fields: ['Kara', 'a scout'],
    })
  })

  it('branchRowsQuery returns clean and stale rows with no stale filter', () => {
    const q = branchRowsQuery('entity', ['b1'])
    const rows = rowsOf(sqlite, q.sql, q.params)
    expect(rows).toHaveLength(1)

    sqlite
      .prepare(
        `insert into entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, 'character', ?, ?, 'active', 'always', 0, ?, ?)`,
      )
      .run('e2', 'b1', 'Rook', 'a guard', now, now)

    const rowsAfter = rowsOf(sqlite, q.sql, q.params)
    expect(rowsAfter.map((r) => r[0]).sort()).toEqual(['e1', 'e2'])
  })
})
