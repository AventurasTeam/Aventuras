import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { branches, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { navigationStore, storiesStore } from '@/lib/stores'

import { openStory, setStoryArchived, setStoryFavorite, touchStoryOpened } from './operational'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({
    id: 'story_1',
    title: 'Aria',
    status: 'active',
    favorite: 0,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'br_1',
  })
  await db.insert(stories).values({
    id: 'draft_1',
    title: 'Draft',
    status: 'draft',
    favorite: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  storiesStore.__reset()
  navigationStore.__reset()
  return { db, ctx: { db, runInTransaction } }
}

describe('stories column writes', () => {
  it('setStoryFavorite persists + re-hydrates + writes no delta', async () => {
    const { db, ctx } = await setup()
    await setStoryFavorite('story_1', true, ctx)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].favorite).toBe(1)
    expect(storiesStore.getStories().rows.find((r) => r.id === 'story_1')?.favorite).toBe(1)
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('setStoryArchived toggles active<->archived; rejects drafts', async () => {
    const { db, ctx } = await setup()
    await setStoryArchived('story_1', true, ctx)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].status).toBe(
      'archived',
    )
    await expect(setStoryArchived('draft_1', true, ctx)).rejects.toThrow(/draft/i)
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('touchStoryOpened sets last_opened_at', async () => {
    const { db, ctx } = await setup()
    await touchStoryOpened('story_1', ctx, 12345)
    expect((await db.select().from(stories).where(eq(stories.id, 'story_1')))[0].lastOpenedAt).toBe(
      12345,
    )
  })

  it('openStory resolves branch, touches, sets navigation, navigates', async () => {
    const { ctx } = await setup()
    const navigate = vi.fn()
    const result = await openStory('story_1', ctx, navigate, 999)
    expect(result).toEqual({ status: 'ok', branchId: 'br_1' })
    expect(navigate).toHaveBeenCalledWith('br_1')
    expect(navigationStore.getNavigation()).toEqual({
      currentStoryId: 'story_1',
      currentBranchId: 'br_1',
    })
  })

  it('openStory returns no-branch when currentBranchId is null', async () => {
    const { ctx } = await setup()
    const result = await openStory('draft_1', ctx, vi.fn(), 999)
    expect(result.status).toBe('no-branch')
  })
})
