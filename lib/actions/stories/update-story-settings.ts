import { eq } from 'drizzle-orm'

import { stories, storySettingsSchema, type DbCtx, type StorySettings } from '@/lib/db'
import { currentStoryStore, rehydrateStories } from '@/lib/stores'

// `stories` is absent from deltas.target_table, so a settings save is a direct
// write: no delta row, no CTRL-Z reversal.
// See data-model.md → Diagram, the deltas entity.
/**
 * @param patch - Shallow-merged onto the stored settings. Nested objects
 * (`models`, `packVariables`, `translation`) are replaced, not merged; a key
 * whose value is `undefined` is left untouched. Pass only the changed keys —
 * spreading a whole settings object in discards any concurrent write that the
 * read picked up.
 */
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
    // Explicit `undefined` typechecks without exactOptionalPropertyTypes, and
    // spreading it in would trip zod's defaults instead of leaving the key alone.
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
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
