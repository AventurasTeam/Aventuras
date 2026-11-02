import { asc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, stories, storyEntries } from '../schema'
import type { NewStoryEntry } from '../types'
import { openRegionSeries, openRegionWhere } from './open-region'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

async function seedBranches(): Promise<TestDb> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  return db
}

const row = (
  id: string,
  position: number,
  overrides: Partial<NewStoryEntry> = {},
): NewStoryEntry => ({
  id,
  branchId: 'b1',
  position,
  kind: 'ai_reply',
  content: `entry ${id}`,
  contentTokens: 7,
  createdAt: position,
  ...overrides,
})

describe('openRegionSeries', () => {
  it('returns every row of a 60-row region in position order, across gaps', async () => {
    const db = await seedBranches()
    // Inserted newest first, with createdAt running against position.
    const positions = Array.from({ length: 60 }, (_, i) => (60 - i) * 3)
    await db
      .insert(storyEntries)
      .values(
        positions.map((position) => row(`e${position}`, position, { createdAt: 1_000 - position })),
      )

    const series = await openRegionSeries('b1', { db })

    expect(series).toHaveLength(60)
    expect(series.map((r) => r.position)).toEqual([...positions].reverse())
  })

  it('leaves out system rows and stamped rows and keeps the opening', async () => {
    const db = await seedBranches()
    await db
      .insert(storyEntries)
      .values([
        row('e_opening', 1, { kind: 'opening' }),
        row('e_stamped', 2, { chapterId: 'ch_1' }),
        row('e_action', 3, { kind: 'user_action' }),
        row('e_banner', 4, { kind: 'system', contentTokens: null }),
      ])

    const series = await openRegionSeries('b1', { db })

    expect(series).toEqual([
      { id: 'e_opening', kind: 'opening', position: 1, tokens: 7 },
      { id: 'e_action', kind: 'user_action', position: 3, tokens: 7 },
    ])
  })

  it('reads a row inserted with no count as 0', async () => {
    const db = await seedBranches()
    await db.insert(storyEntries).values({
      id: 'e_old',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'written before the column',
      createdAt: 1,
    })

    expect(await openRegionSeries('b1', { db })).toEqual([
      { id: 'e_old', kind: 'ai_reply', position: 1, tokens: 0 },
    ])
  })

  it("leaves out another branch's open rows", async () => {
    const db = await seedBranches()
    await db.insert(storyEntries).values([row('e_here', 1), row('e_there', 1, { branchId: 'b2' })])

    const series = await openRegionSeries('b1', { db })

    expect(series.map((r) => r.id)).toEqual(['e_here'])
  })

  it('breaks a position tie by createdAt, as the prompt buffer does', async () => {
    const db = await seedBranches()
    await db
      .insert(storyEntries)
      .values([row('e_later', 5, { createdAt: 20 }), row('e_earlier', 5, { createdAt: 10 })])

    const series = await openRegionSeries('b1', { db })

    expect(series.map((r) => r.id)).toEqual(['e_earlier', 'e_later'])
  })

  it('reads an empty region as no rows', async () => {
    const db = await seedBranches()
    expect(await openRegionSeries('b1', { db })).toEqual([])
  })
})

describe('openRegionWhere', () => {
  it('selects the rows the series returns', async () => {
    const db = await seedBranches()
    await db
      .insert(storyEntries)
      .values([
        row('e_opening', 1, { kind: 'opening' }),
        row('e_stamped', 2, { chapterId: 'ch_1' }),
        row('e_banner', 3, { kind: 'system' }),
        row('e_reply', 4),
        row('e_there', 4, { branchId: 'b2' }),
      ])

    const selected = await db
      .select({ id: storyEntries.id })
      .from(storyEntries)
      .where(openRegionWhere('b1'))
      .orderBy(asc(storyEntries.position))
    const series = await openRegionSeries('b1', { db })

    expect(selected.map((r) => r.id)).toEqual(['e_opening', 'e_reply'])
    expect(series.map((r) => r.id)).toEqual(selected.map((r) => r.id))
  })
})
