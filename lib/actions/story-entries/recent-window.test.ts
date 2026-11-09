import { beforeEach, describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readEntriesBetween } from './recent-window'

type Db = Awaited<ReturnType<typeof createTestDb>>['db']

const entry = (branchId: string, id: string, position: number) => ({
  id,
  branchId,
  position,
  kind: 'user_action' as const,
  content: id,
  createdAt: position,
})

describe('entry reads', () => {
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
      .values([
        entry('br_a', 'e1', 1),
        entry('br_a', 'e2', 2),
        entry('br_a', 'shared', 3),
        entry('br_a', 'e4', 4),
        entry('br_b', 'shared', 9),
      ])
  })

  describe('readEntriesBetween', () => {
    it('includes fromPosition, excludes beforePosition, ascending', async () => {
      const rows = await readEntriesBetween('br_a', 2, 4, db)
      expect(rows.map((r) => r.position)).toEqual([2, 3])
    })

    it('reads only this branch', async () => {
      const rows = await readEntriesBetween('br_b', 1, 100, db)
      expect(rows.map((r) => r.id)).toEqual(['shared'])
    })

    it('is empty when the target already sits at or past the bound', async () => {
      expect(await readEntriesBetween('br_a', 3, 3, db)).toEqual([])
      expect(await readEntriesBetween('br_a', 4, 2, db)).toEqual([])
    })
  })
})
