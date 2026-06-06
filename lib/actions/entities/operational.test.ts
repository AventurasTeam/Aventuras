import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, entities, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore } from '@/lib/stores'

import { setEntityOperationalFlags } from './operational'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(entities).values({
    id: 'char_1',
    branchId: 'br_1',
    kind: 'character',
    name: 'Kael',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  entitiesStore.__reset()
  entitiesStore.hydrate('br_1', [
    (await db.select().from(entities).where(eq(entities.id, 'char_1')))[0],
  ])
  return { db, ctx: { db, runInTransaction } }
}

describe('setEntityOperationalFlags', () => {
  it('updates the column + store without writing a delta', async () => {
    const { db, ctx } = await setup()
    await setEntityOperationalFlags(
      'br_1',
      'char_1',
      { embeddingStale: true, nameCollisionFlag: true },
      ctx,
    )

    const [row] = await db.select().from(entities).where(eq(entities.id, 'char_1'))
    expect(row.embeddingStale).toBe(1)
    expect(row.nameCollisionFlag).toBe(1)
    expect(entitiesStore.getById('char_1')?.embeddingStale).toBe(1)
    expect((await db.select().from(deltas)).length).toBe(0) // non-delta path
  })

  it('is a no-op when the flags object is empty', async () => {
    const { db, ctx } = await setup()
    await setEntityOperationalFlags('br_1', 'char_1', {}, ctx)
    const [row] = await db.select().from(entities).where(eq(entities.id, 'char_1'))
    expect(row.embeddingStale).toBe(0) // unchanged from the insert default
    expect(entitiesStore.getById('char_1')?.embeddingStale).toBe(0)
  })
})
