import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { batchOn, queryOn } from './service'

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
