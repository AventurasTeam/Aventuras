import { eq } from 'drizzle-orm'

import { stories } from '@/lib/db'
import { navigationStore, rehydrateStories } from '@/lib/stores'

import type { DbCtx } from '../types'

export async function setStoryFavorite(id: string, favorite: boolean, ctx: DbCtx): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ favorite: favorite ? 1 : 0 })
      .where(eq(stories.id, id))
      .toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export async function setStoryArchived(id: string, archived: boolean, ctx: DbCtx): Promise<void> {
  const [row] = await ctx.db
    .select({ status: stories.status })
    .from(stories)
    .where(eq(stories.id, id))
  if (row?.status === 'draft') throw new Error('cannot archive a draft story')
  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ status: archived ? 'archived' : 'active' })
      .where(eq(stories.id, id))
      .toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export async function touchStoryOpened(id: string, ctx: DbCtx, nowSec: number): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.update(stories).set({ lastOpenedAt: nowSec }).where(eq(stories.id, id)).toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export type OpenStoryResult = { status: 'ok'; branchId: string } | { status: 'no-branch' }

/** Resolve current branch, touch last_opened_at, set navigation, then navigate. */
export async function openStory(
  id: string,
  ctx: DbCtx,
  navigate: (branchId: string) => void,
  nowSec: number,
): Promise<OpenStoryResult> {
  const [row] = await ctx.db
    .select({ branchId: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, id))
  const branchId = row?.branchId ?? null
  if (branchId == null) return { status: 'no-branch' }
  await touchStoryOpened(id, ctx, nowSec)
  navigationStore.setCurrentStory(id)
  navigationStore.setCurrentBranch(branchId)
  navigate(branchId)
  return { status: 'ok', branchId }
}
