import { describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, stories, storyEntries } from '../schema'
import type { NewStoryEntry } from '../types'
import { readChapterTimeRanges } from './chapter-time-ranges'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

async function seed(rows: NewStoryEntry[]): Promise<TestDb> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  await db.insert(storyEntries).values(rows)
  return db
}

let position = 0
function row(
  chapterId: string | null,
  worldTime: number | null,
  overrides: Partial<NewStoryEntry> = {},
): NewStoryEntry {
  position += 1
  return {
    id: `e${position}`,
    branchId: 'b1',
    position,
    kind: 'ai_reply',
    content: 'x',
    chapterId,
    metadata: worldTime == null ? null : { sceneEntities: [], currentLocationId: null, worldTime },
    createdAt: position,
    ...overrides,
  }
}

describe('readChapterTimeRanges', () => {
  it('takes min and max per chapter, whatever the rows order', async () => {
    const db = await seed([
      row('ch_1', 300),
      row('ch_1', 120),
      row('ch_1', 240),
      row('ch_2', 900),
      row('ch_2', 600),
    ])

    const ranges = await readChapterTimeRanges('b1', db)

    expect(ranges).toEqual(
      new Map([
        ['ch_1', { first: 120, last: 300 }],
        ['ch_2', { first: 600, last: 900 }],
      ]),
    )
  })

  it('leaves out a row at 0 and a row with no world time', async () => {
    const db = await seed([row('ch_1', 0), row('ch_1', 120), row('ch_1', null), row('ch_1', 300)])

    expect((await readChapterTimeRanges('b1', db)).get('ch_1')).toEqual({ first: 120, last: 300 })
  })

  it('leaves out a system row, on a chapter and in the open region', async () => {
    const db = await seed([
      row('ch_1', 120),
      row('ch_1', 60, { kind: 'system' }),
      row('ch_1', 9_000, { kind: 'system' }),
      row(null, 600),
      row(null, 30, { kind: 'system' }),
    ])

    const ranges = await readChapterTimeRanges('b1', db)

    expect(ranges.get('ch_1')).toEqual({ first: 120, last: 120 })
    expect(ranges.get(null)).toEqual({ first: 600, last: 600 })
  })

  it('keys the open region as null', async () => {
    const db = await seed([row('ch_1', 120), row(null, 600), row(null, 720)])

    expect((await readChapterTimeRanges('b1', db)).get(null)).toEqual({ first: 600, last: 720 })
  })

  it('has no key for a chapter with no time, or an open region with none', async () => {
    const db = await seed([row('ch_1', 0), row('ch_1', null), row('ch_2', 120), row(null, 0)])

    const ranges = await readChapterTimeRanges('b1', db)

    expect([...ranges.keys()]).toEqual(['ch_2'])
  })

  it('reads one branch', async () => {
    const db = await seed([row('ch_1', 120), row('ch_1', 900, { branchId: 'b2' })])

    expect((await readChapterTimeRanges('b1', db)).get('ch_1')).toEqual({ first: 120, last: 120 })
    expect((await readChapterTimeRanges('b2', db)).get('ch_1')).toEqual({ first: 900, last: 900 })
  })

  it('is empty for a branch with no entries', async () => {
    const db = await seed([row('ch_1', 120)])

    expect((await readChapterTimeRanges('b2', db)).size).toBe(0)
  })
})
