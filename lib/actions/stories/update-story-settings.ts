import { eq } from 'drizzle-orm'

import { stories, storySettingsSchema, type DbCtx, type StorySettings } from '@/lib/db'
import { currentStoryStore, rehydrateStories } from '@/lib/stores'

// `stories` is absent from deltas.target_table, so a settings save is a direct
// write: no delta row, no CTRL-Z reversal.
// See data-model.md → Entry mutability & rollback.
export async function updateStorySettings(
  storyId: string,
  patch: Partial<StorySettings>,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<StorySettings> {
  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!row) throw new Error('Story not found')

  const settings = storySettingsSchema.parse({
    ...storySettingsSchema.parse(row.settings),
    ...patch,
  })

  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ settings, updatedAt: nowMs })
      .where(eq(stories.id, storyId))
      .toSQL(),
  ])

  await rehydrateStories(ctx.db)
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId === storyId) currentStoryStore.set({ ...open, settings })
  return settings
}
