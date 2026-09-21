import { describe, expect, it } from 'vitest'

import { branches, storyEntries, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { indexEntryRefs, readEntryIndex } from './read'

async function setup() {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 },
  ])
  await db.insert(storyEntries).values([
    {
      id: 'e_1',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'You arrive.',
      chapterId: 'chap_1',
      createdAt: 1,
    },
    {
      id: 'e_2',
      branchId: 'br_1',
      position: 2,
      kind: 'user_action',
      content:
        '  I draw   the blade and listen for footsteps in the long dark of the keep beneath the river.  ',
      chapterId: null,
      createdAt: 2,
    },
    {
      id: 'e_x',
      branchId: 'br_2',
      position: 1,
      kind: 'opening',
      content: 'Other branch.',
      chapterId: null,
      createdAt: 1,
    },
  ])
  return db
}

describe('readEntryIndex', () => {
  it('lists the branch newest first with a collapsed excerpt and the chapter id', async () => {
    const db = await setup()
    const rows = await readEntryIndex('br_1', db)
    expect(rows.map((r) => r.id)).toEqual(['e_2', 'e_1'])
    expect(rows[0]).toMatchObject({ position: 2, kind: 'user_action', chapterId: null })
    expect(rows[0].excerpt.startsWith('I draw the blade')).toBe(true)
    expect(rows[1]).toMatchObject({ position: 1, chapterId: 'chap_1', excerpt: 'You arrive.' })
  })

  it('indexes by id', async () => {
    const db = await setup()
    const index = indexEntryRefs(await readEntryIndex('br_1', db))
    expect(index.get('e_1')?.position).toBe(1)
    expect(index.has('e_x')).toBe(false)
  })
})
