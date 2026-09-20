import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { storyHasTurns } from './has-turns'

// story_1 holds what a failed first submit leaves: the opening plus a system notice.
async function seed() {
  const { db } = await createTestDb()
  await db.insert(stories).values([
    { id: 'story_1', title: 'Aria', createdAt: 1, updatedAt: 1 },
    { id: 'story_2', title: 'Brin', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(branches).values([
    { id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'branch_2', storyId: 'story_1', name: 'fork', createdAt: 1 },
    { id: 'branch_3', storyId: 'story_2', name: 'main', createdAt: 1 },
  ])
  await db.insert(storyEntries).values([
    {
      id: 'e1',
      branchId: 'branch_1',
      position: 1,
      kind: 'opening',
      content: 'Once.',
      createdAt: 1,
    },
    {
      id: 'e2',
      branchId: 'branch_1',
      position: 2,
      kind: 'system',
      content: 'Generation failed.',
      createdAt: 2,
    },
  ])
  return db
}

describe('storyHasTurns', () => {
  it('ignores the opening and a system notice', async () => {
    const db = await seed()
    expect(await storyHasTurns('story_1', db)).toBe(false)
  })

  it('does not count a turn from another story', async () => {
    const db = await seed()
    await db.insert(storyEntries).values({
      id: 'e3',
      branchId: 'branch_3',
      position: 1,
      kind: 'user_action',
      content: 'I look.',
      createdAt: 3,
    })
    expect(await storyHasTurns('story_1', db)).toBe(false)
    expect(await storyHasTurns('story_2', db)).toBe(true)
  })

  it('counts a user action on any branch', async () => {
    const db = await seed()
    await db.insert(storyEntries).values({
      id: 'e3',
      branchId: 'branch_2',
      position: 2,
      kind: 'user_action',
      content: 'I look.',
      createdAt: 3,
    })
    expect(await storyHasTurns('story_1', db)).toBe(true)
  })

  it('counts a branch holding only an AI reply', async () => {
    const db = await seed()
    await db.insert(storyEntries).values({
      id: 'e3',
      branchId: 'branch_2',
      position: 2,
      kind: 'ai_reply',
      content: 'The door creaks.',
      createdAt: 3,
    })
    expect(await storyHasTurns('story_1', db)).toBe(true)
  })
})
