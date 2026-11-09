import { beforeEach, describe, expect, it } from 'vitest'

import { createTestDb } from '../__tests__/test-db'
import { branches, stories, storyEntries } from '../schema'
import { readEntryPosition } from './entry-position'

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

const entry = (branchId: string, id: string, position: number) => ({
  id,
  branchId,
  position,
  kind: 'user_action' as const,
  content: id,
  createdAt: position,
})

describe('readEntryPosition', () => {
  let db: Db

  beforeEach(async () => {
    ;({ db } = await createTestDb())
    await db.insert(stories).values({ id: 's1', title: 'S', createdAt: 0, updatedAt: 0 })
    await db.insert(branches).values([
      { id: 'br_a', storyId: 's1', name: 'A', createdAt: 0 },
      { id: 'br_b', storyId: 's1', name: 'B', createdAt: 0 },
    ])
    // A branch copy keeps its ids, so `shared` sits at different positions on the two branches.
    await db
      .insert(storyEntries)
      .values([entry('br_a', 'e1', 1), entry('br_a', 'shared', 3), entry('br_b', 'shared', 9)])
  })

  it("reads the row's position on this branch", async () => {
    expect(await readEntryPosition('br_a', 'shared', db)).toBe(3)
    expect(await readEntryPosition('br_b', 'shared', db)).toBe(9)
  })

  it('is null for an id not on the branch', async () => {
    expect(await readEntryPosition('br_b', 'e1', db)).toBeNull()
  })
})
