import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { clearSystemEntry, writeSystemEntry } from './system-entry'

let ctx: {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
}

beforeEach(async () => {
  const { db, runInTransaction } = await createTestDb()
  ctx = { db, runInTransaction }
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(storyEntries).values([
    { id: 'e1', branchId: 'b1', position: 1, kind: 'opening', content: 'once', createdAt: 1 },
    { id: 'e2', branchId: 'b1', position: 2, kind: 'user_action', content: 'go', createdAt: 2 },
  ])
})
afterEach(() => {
  ctx = undefined as never
})

const systemRows = () => ctx.db.select().from(storyEntries).where(eq(storyEntries.kind, 'system'))

describe('writeSystemEntry', () => {
  it('inserts a kind=system entry at the branch tail with null metadata', async () => {
    const id = await writeSystemEntry({ branchId: 'b1', content: 'config broken' }, ctx)
    const rows = await systemRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id,
      kind: 'system',
      content: 'config broken',
      position: 3,
      metadata: null,
    })
  })

  it('is a singleton — a second write replaces the first at the new tail', async () => {
    await writeSystemEntry({ branchId: 'b1', content: 'first' }, ctx)
    await writeSystemEntry({ branchId: 'b1', content: 'second' }, ctx)
    const rows = await systemRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('second')
    expect(rows[0].position).toBe(3) // prior system entry cleared before MAX(position) recomputed
  })
})

describe('clearSystemEntry', () => {
  it('removes the system entry', async () => {
    await writeSystemEntry({ branchId: 'b1', content: 'x' }, ctx)
    await clearSystemEntry('b1', ctx)
    expect(await systemRows()).toHaveLength(0)
  })

  it('is a no-op when no system entry exists', async () => {
    await clearSystemEntry('b1', ctx)
    expect(await systemRows()).toHaveLength(0)
    expect((await ctx.db.select().from(storyEntries)).length).toBe(2) // content entries untouched
  })
})
