import { eq } from 'drizzle-orm'

import { stories } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
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
  if (!row) throw new Error('Story not found')
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

export async function touchStoryOpened(
  id: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  await ctx.runInTransaction([
    ctx.db.update(stories).set({ lastOpenedAt: nowMs }).where(eq(stories.id, id)).toSQL(),
  ])
  await rehydrateStories(ctx.db)
}

export type OpenStoryResult = { status: 'ok'; branchId: string } | { status: 'no-branch' }

export async function openStory(
  id: string,
  ctx: DbCtx,
  navigate: (branchId: string) => void,
  nowMs: number = Date.now(),
): Promise<OpenStoryResult> {
  const [row] = await ctx.db
    .select({ branchId: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, id))
  const branchId = row?.branchId ?? null
  if (branchId == null) return { status: 'no-branch' }
  navigationStore.setCurrentStory(id)
  navigationStore.setCurrentBranch(branchId)
  navigate(branchId)
  // update the timestamp last so navigate isn't blocked
  await touchStoryOpened(id, ctx, nowMs).catch((err: unknown) => {
    logger.error('action_layer.story_touch_failed', {
      storyId: id,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  return { status: 'ok', branchId }
}
