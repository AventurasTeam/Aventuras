import { eq } from 'drizzle-orm'

import { buildStorySettings, stories, type DbCtx } from '@/lib/db'
import { appSettingsStore, rehydrateStories, storiesStore } from '@/lib/stores'

export async function resetStorySettings(
  storyId: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  const [story] = await ctx.db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!story) throw new Error('Story not found')

  const appSettings = appSettingsStore.getAppSettings()
  const settings = buildStorySettings(
    appSettings.defaultStorySettings,
    appSettings.embeddingModelId,
  )

  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ settings, updatedAt: nowMs })
      .where(eq(stories.id, storyId))
      .toSQL(),
  ])
  const refreshed = await rehydrateStories(ctx.db)
  if (refreshed) storiesStore.clearOpenFailure(storyId, 'settings-corrupt')
}
