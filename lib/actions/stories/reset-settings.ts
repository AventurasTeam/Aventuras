import { eq } from 'drizzle-orm'

import { buildStorySettings, stories, type DbCtx } from '@/lib/db'
import { appSettingsStore, rehydrateStories, storiesStore } from '@/lib/stores'

export async function resetStorySettings(
  storyId: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  const [story] = await ctx.db
    .select({ id: stories.id, definition: stories.definition })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!story) throw new Error('Story not found')

  const appSettings = appSettingsStore.getAppSettings()
  const settings = buildStorySettings(
    // A draft row has no definition yet, so there is no mode to seed a palette
    // from; creative is the wizard's own starting mode.
    story.definition?.mode ?? 'creative',
    appSettings.defaultStorySettings,
    appSettings.embeddingModelId,
    appSettings.embeddingProviderId,
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
