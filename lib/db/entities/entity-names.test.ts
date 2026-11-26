import { describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, entities, stories } from '../schema'
import type { NewEntity } from '../types'
import { readEntityNames } from './entity-names'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const row = (id: string, branchId: string, kind: NewEntity['kind'], name: string): NewEntity => ({
  id,
  branchId,
  kind,
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

// Rows go in as listed: put a sibling's first, so a read by id alone meets it first.
async function seed(rows: NewEntity[]): Promise<TestDb> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  for (const r of rows) await db.insert(entities).values(r)
  return db
}

describe('readEntityNames', () => {
  it("returns the names of the branch's rows among the ids, by id, and leaves out one it doesn't hold", async () => {
    const db = await seed([
      row('char_aria', 'b1', 'character', 'Aria'),
      row('char_wren', 'b1', 'character', 'Wren'),
      row('loc_ford', 'b1', 'location', 'The ford'),
    ])

    expect(await readEntityNames('b1', ['char_wren', 'char_gone', 'loc_ford'], db)).toEqual(
      new Map([
        ['char_wren', 'Wren'],
        ['loc_ford', 'The ford'],
      ]),
    )
  })

  it("never returns another branch's row with the same id", async () => {
    const db = await seed([
      row('char_aria', 'b2', 'character', 'Aria of the fork'),
      row('char_aria', 'b1', 'character', 'Aria'),
    ])

    expect(await readEntityNames('b1', ['char_aria'], db)).toEqual(new Map([['char_aria', 'Aria']]))
    expect(await readEntityNames('b2', ['char_aria'], db)).toEqual(
      new Map([['char_aria', 'Aria of the fork']]),
    )
  })

  it('returns no name for no ids', async () => {
    const db = await seed([row('char_aria', 'b1', 'character', 'Aria')])

    expect(await readEntityNames('b1', [], db)).toEqual(new Map())
  })
})
