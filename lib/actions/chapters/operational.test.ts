import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, chapters, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { chaptersStore } from '@/lib/stores'

import { setChapterOperationalFlags } from './operational'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(chapters).values({
    id: 'chap_1',
    branchId: 'br_1',
    sequenceNumber: 1,
    title: 'One',
    summary: 'S',
    theme: 'T',
    startEntryId: 'se_1',
    endEntryId: 'se_2',
    tokenCount: 1000,
    closedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  })
  chaptersStore.__reset()
  chaptersStore.hydrate('br_1', [
    (await db.select().from(chapters).where(eq(chapters.id, 'chap_1')))[0],
  ])
  return { db, ctx: { db, runInTransaction } }
}

describe('setChapterOperationalFlags', () => {
  it('updates the column + store without writing a delta', async () => {
    const { db, ctx } = await setup()
    await setChapterOperationalFlags('br_1', 'chap_1', { embeddingStale: true }, ctx)
    const [row] = await db.select().from(chapters).where(eq(chapters.id, 'chap_1'))
    expect(row.embeddingStale).toBe(1)
    expect(chaptersStore.getById('chap_1')?.embeddingStale).toBe(1)
    expect((await db.select().from(deltas)).length).toBe(0) // non-delta path
  })

  it('is a no-op when the flags object is empty', async () => {
    const { db, ctx } = await setup()
    await setChapterOperationalFlags('br_1', 'chap_1', {}, ctx)
    const [row] = await db.select().from(chapters).where(eq(chapters.id, 'chap_1'))
    expect(row.embeddingStale).toBe(0) // unchanged from the insert default
  })
})
