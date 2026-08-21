import { eq } from 'drizzle-orm'

import {
  branches,
  buildStorySettings,
  flagBranchesEmbeddingStaleOps,
  setSettingsKeysOps,
  stories,
  storySettingsSchema,
  type DbCtx,
  type SqlOp,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { appSettingsStore, rehydrateStories, storiesStore } from '@/lib/stores'

import { StorySettingsStaleStoreError } from './update-story-settings'

/**
 * Reset must not touch these: nothing re-derives staleness from a relabel
 * (`retrieval.md → Matryoshka effective dim`), and the swap markers are the
 * only record of an in-flight target a reset can land mid-swap. The key-scoped
 * write already spares them; this list holds the line if it ever grows one.
 */
const ENGINE_OWNED_KEYS = new Set<keyof StorySettings>([
  'embeddingBackend',
  'embedding_model_id',
  'embedding_provider_id',
  'effectiveDim',
  'embedding_swap_target',
  'embedding_swap_backend',
  'embedding_swap_provider_id',
  'embedding_swap_source_dim',
  'embedding_swap_target_dim',
])

/**
 * The repair branch feeds this a blob that failed its schema, so all four fields
 * may be absent or wrong-typed. The backend goes through the schema's own enum
 * so the check cannot drift, via `safeParse` so garbage falls back not throws.
 */
function lockedEmbedding(settings: StorySettings | null): {
  backend: StorySettings['embeddingBackend'] | null
  modelId: string | null
  providerId: string | null
  effectiveDim: number | null
} {
  const raw = (settings ?? {}) as Record<string, unknown>
  const dim = raw.effectiveDim
  const backend = storySettingsSchema.shape.embeddingBackend.safeParse(raw.embeddingBackend)
  return {
    backend: backend.success ? backend.data : null,
    // Trimmed-empty is absent, not a model id — matching `resolveEmbedderConfig`'s
    // own emptiness check, which trims before testing.
    modelId:
      typeof raw.embedding_model_id === 'string' && raw.embedding_model_id.trim() !== ''
        ? raw.embedding_model_id
        : null,
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
  // definition is nullable at the column level; creative is the wizard's
  // starting mode, used if a row somehow has none.
  const mode = story.definition?.mode ?? 'creative'
  const stored = storySettingsSchema.safeParse(story.settings)

  if (stored.success) {
    const resettable: Partial<StorySettings> = { ...buildStorySettings(mode, appSettings) }
    for (const key of ENGINE_OWNED_KEYS) delete resettable[key]
    await ctx.runInTransaction(setSettingsKeysOps(storyId, resettable, nowMs))
  } else {
    // `loadSwapContext` refuses a schema-failing blob, so this whole-column write
    // only clobbers live markers if corruption lands mid-swap — which phase 2's
    // `assertStoryLive` preflight narrows rather than closes.
    const locked = lockedEmbedding(story.settings)
    // A model id alone is not an embedder identity (`embeddingTargetKey`): mixing
    // story and app sources assembles an embedder that never existed, resolving
    // `ok` before it fails in the call. All or nothing — the fallback re-indexes.
    const carried =
      locked.backend != null && locked.modelId != null
        ? { ...locked, backend: locked.backend, modelId: locked.modelId }
        : null
    const settings = buildStorySettings(
      mode,
      {
        ...appSettings,
        // The backend has no parameter of its own; it rides the template spread.
        defaultStorySettings: {
          ...appSettings.defaultStorySettings,
          ...(carried ? { embeddingBackend: carried.backend } : {}),
        },
        embeddingModelId: carried ? carried.modelId : appSettings.embeddingModelId,
        embeddingProviderId: carried ? carried.providerId : appSettings.embeddingProviderId,
      },
      carried ? carried.effectiveDim : null,
    )
    if (settings.embeddingBackend === 'local') {
      // Truncation is provider-only, so on local both keys describe nothing while
      // still reading live — as `setEmbeddingTargetOp` has it on a flip to local.
      delete settings.embedding_provider_id
      delete settings.effectiveDim
    }
    // A dropped carry relabels the story onto an embedder that never wrote its
    // vectors, and nothing re-derives staleness from a relabel: retrieval misses
    // silently while the pill calls the index current, forever. Flagged on every
    // drop, not just an id change — per-row comparison costs more than it saves.
    let staleOps: SqlOp[] = []
    if (carried === null) {
      const branchRows = await ctx.db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.storyId, storyId))
      staleOps = flagBranchesEmbeddingStaleOps(branchRows.map((branch) => branch.id))
    }
    // The blob is overwritten below, so this is the only record of what was wrong
    // with it. Paths, not values: a settings key can hold user prose.
    logger.error('action_layer.story_settings_repaired', {
      storyId,
      issues: stored.error.issues.map((issue) => issue.path.join('.')),
      carriedEmbedder: carried !== null,
      dirtiedBranches: staleOps.length > 0,
    })
    await ctx.runInTransaction([
      ctx.db
        .update(stories)
        .set({ settings, updatedAt: nowMs })
        .where(eq(stories.id, storyId))
        .toSQL(),
      ...staleOps,
    ])
  }

  // Mirrors updateStorySettings: a silent return reports success while the
  // corrupt flag stays set, dropping the user back into the dialog they just used.
  if (!(await rehydrateStories(ctx.db))) throw new StorySettingsStaleStoreError()
  storiesStore.clearOpenFailure(storyId, 'settings-corrupt')
}
