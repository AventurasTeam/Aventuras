import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, lore, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { loreStore } from '@/lib/stores'

import { setLoreOperationalFlags } from './operational'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: 'br_1',
    title: 'Aether',
    injectionMode: 'auto',
    // Explicit: the no-op case asserts a clean row stays clean; the default is dirty.
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  loreStore.__reset()
  loreStore.hydrate('br_1', [(await db.select().from(lore).where(eq(lore.id, 'lore_1')))[0]])
  return { db, ctx: { db, runInTransaction } }
}

describe('setLoreOperationalFlags', () => {
  it('updates the column + store without writing a delta', async () => {
    const { db, ctx } = await setup()
    await setLoreOperationalFlags('br_1', 'lore_1', { embeddingStale: true }, ctx)
    const [row] = await db.select().from(lore).where(eq(lore.id, 'lore_1'))
    expect(row.embeddingStale).toBe(1)
    expect(loreStore.getById('lore_1')?.embeddingStale).toBe(1)
    expect((await db.select().from(deltas)).length).toBe(0) // non-delta path
  })

  it('is a no-op when the flags object is empty', async () => {
    const { db, ctx } = await setup()
    await setLoreOperationalFlags('br_1', 'lore_1', {}, ctx)
    const [row] = await db.select().from(lore).where(eq(lore.id, 'lore_1'))
    expect(row.embeddingStale).toBe(0) // unchanged from the insert default
    expect(loreStore.getById('lore_1')?.embeddingStale).toBe(0)
  })
})
