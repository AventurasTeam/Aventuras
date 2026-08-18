import { eq } from 'drizzle-orm'

import { buildStorySettings, stories, type DbCtx, type StorySettings } from '@/lib/db'
import { appSettingsStore, rehydrateStories, storiesStore } from '@/lib/stores'

/**
 * The trio a story locks at creation (`retrieval.md → Matryoshka effective
 * dim`). Rebuilding them from current app defaults relabels a story whose
 * every stored vector is under the old model and dim, and nothing re-derives
 * staleness from a relabel — so reset must carry them across.
 *
 * Read defensively: reset is also the repair path for a settings blob that
 * failed its schema, so any of the three may be absent or wrong-typed.
 */
function lockedEmbedding(settings: StorySettings | null): {
  modelId: string | null
  providerId: string | null
  effectiveDim: number | null
} {
  const raw = (settings ?? {}) as Record<string, unknown>
  const dim = raw.effectiveDim
  return {
    modelId: typeof raw.embedding_model_id === 'string' ? raw.embedding_model_id : null,
    providerId: typeof raw.embedding_provider_id === 'string' ? raw.embedding_provider_id : null,
    effectiveDim: typeof dim === 'number' && Number.isInteger(dim) && dim > 0 ? dim : null,
  }
}

export async function resetStorySettings(
  storyId: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<void> {
  const [story] = await ctx.db
    .select({ id: stories.id, definition: stories.definition, settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!story) throw new Error('Story not found')

  const appSettings = appSettingsStore.getAppSettings()
  const locked = lockedEmbedding(story.settings)
  const settings = buildStorySettings(
    // definition is nullable at the column level; creative is the wizard's
    // starting mode, used if a row somehow has none.
    story.definition?.mode ?? 'creative',
    {
      ...appSettings,
      embeddingModelId: locked.modelId ?? appSettings.embeddingModelId,
      embeddingProviderId: locked.providerId ?? appSettings.embeddingProviderId,
    },
    locked.effectiveDim,
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
