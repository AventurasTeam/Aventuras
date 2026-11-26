import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { makeCallback } from './test-db'

function db(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE a (id INTEGER, x TEXT); CREATE TABLE b (id INTEGER, a_id INTEGER);
    INSERT INTO a VALUES (1, 'ax'); INSERT INTO b VALUES (3, 1);`)
  return sqlite
}

describe("the test db's proxy callback", () => {
  it('keeps two same-named columns of a join apart, in select order', async () => {
    const query = makeCallback(db())
    const sql = 'SELECT a.id, a.x, b.id FROM a JOIN b ON b.a_id = a.id'
    expect((await query(sql, [], 'all')).rows).toEqual([[1, 'ax', 3]])
    expect((await query(sql, [], 'get')).rows).toEqual([1, 'ax', 3])
  })

  it('keeps a numeric alias where the select puts it', async () => {
    const { rows } = await makeCallback(db())('SELECT \'v\' AS name, 7 AS "0"', [], 'all')
    expect(rows).toEqual([['v', 7]])
  })
})
