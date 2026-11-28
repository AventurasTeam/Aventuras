import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { getLoadablePath } from 'sqlite-vec'
import { describe, expect, it, vi } from 'vitest'

import { batchOn, migrateOn, queryOn } from './service'
import type { DbProxyMethod } from './types'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))

function db(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE a (id INTEGER, x TEXT); CREATE TABLE b (id INTEGER, a_id INTEGER);
    INSERT INTO a VALUES (1, 'ax'); INSERT INTO b VALUES (3, 1);`)
  return sqlite
}

describe('queryOn', () => {
  it('keeps two same-named columns of a join apart, in select order', () => {
    const sql = 'SELECT a.id, a.x, b.id FROM a JOIN b ON b.a_id = a.id'
    expect(queryOn(db(), sql, [], 'all').rows).toEqual([[1, 'ax', 3]])
    expect(queryOn(db(), sql, [], 'get').rows).toEqual([1, 'ax', 3])
  })

  it('keeps a numeric alias where the select puts it', () => {
    expect(queryOn(db(), 'SELECT \'v\' AS name, 7 AS "0"', [], 'all').rows).toEqual([['v', 7]])
  })

  it('answers a get that matched nothing with no row', () => {
    expect(queryOn(db(), 'SELECT id FROM a WHERE id = ?', [9], 'get').rows).toBeUndefined()
  })
})

describe('batchOn', () => {
  it("answers each query in queryOn's shape, in query order", () => {
    expect(
      batchOn(db(), [
        { sql: 'SELECT id, x FROM a', params: [], method: 'all' },
        { sql: 'SELECT id FROM b WHERE id = ?', params: [3], method: 'get' },
        { sql: 'SELECT id FROM a WHERE id = ?', params: [9], method: 'get' },
        { sql: 'UPDATE a SET x = ? WHERE id = ?', params: ['ay', 1], method: 'run' },
      ]),
    ).toEqual([{ rows: [[1, 'ax']] }, { rows: [3] }, { rows: undefined }, { rows: [] }])
  })

  it('answers in the call itself, not with a promise', () => {
    const answer = batchOn(db(), [{ sql: 'SELECT id FROM a', params: [], method: 'all' }])
    expect(answer).not.toBeInstanceOf(Promise)
    expect(answer).toEqual([{ rows: [[1]] }])
  })

  // One synchronous call: a write queued while it runs can land only after it returns.
  it('lands a write queued during the first read only after the second read', async () => {
    const sqlite = db()
    sqlite.function('queue_write', () => {
      queueMicrotask(() => sqlite.exec('INSERT INTO b VALUES (4, 1)'))
      return 1
    })

    const [first, second] = batchOn(sqlite, [
      { sql: 'SELECT queue_write()', params: [], method: 'all' },
      { sql: 'SELECT count(*) FROM b', params: [], method: 'all' },
    ])

    expect(first).toEqual({ rows: [[1]] })
    expect(second).toEqual({ rows: [[1]] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queryOn(sqlite, 'SELECT count(*) FROM b', [], 'all').rows).toEqual([[2]])
  })
})

describe('migrateOn', () => {
  const MIGRATIONS = 'lib/db/migrations'

  function opened(): DatabaseSync {
    const sqlite = new DatabaseSync(':memory:', { allowExtension: true })
    sqlite.loadExtension(getLoadablePath())
    sqlite.exec('PRAGMA foreign_keys = ON;')
    return sqlite
  }

  async function boot(sqlite: DatabaseSync, exec = (q: string) => sqlite.exec(q)): Promise<void> {
    const proxy = drizzle(async (s, p, m) => queryOn(sqlite, s, p, m as DbProxyMethod))
    await migrate(proxy, (queries) => Promise.resolve(migrateOn({ exec }, queries)), {
      migrationsFolder: MIGRATIONS,
    })
  }

  function column(sqlite: DatabaseSync, sql: string): unknown[] {
    return (queryOn(sqlite, sql, [], 'all').rows as unknown[][]).map((row) => row[0])
  }

  it('leaves nothing of a boot killed mid-rebuild, so the next boot migrates cleanly', async () => {
    const sqlite = opened()
    const killed = boot(sqlite, (q) => {
      if (q.includes('INSERT INTO `__new_')) throw new Error('killed mid-rebuild')
      sqlite.exec(q)
    })
    await expect(killed).rejects.toThrow('killed mid-rebuild')
    expect(
      column(sqlite, "SELECT name FROM sqlite_master WHERE name LIKE '\\_\\_new\\_%' ESCAPE '\\'"),
    ).toEqual([])
    expect(column(sqlite, 'SELECT count(*) FROM __drizzle_migrations')).toEqual([0])

    await boot(sqlite)

    const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
      entries: unknown[]
    }
    expect(column(sqlite, 'SELECT count(*) FROM __drizzle_migrations')).toEqual([
      journal.entries.length,
    ])
  })
})
