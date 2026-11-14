import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { queryOn } from './service'

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
