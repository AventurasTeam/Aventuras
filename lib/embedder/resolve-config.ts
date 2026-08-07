import type { StorySettings } from '@/lib/db'

import { localModelDim } from './catalog'
import type { EmbedderConfig } from './types'

export type EmbedderConfigResolution =
  | { ok: true; config: EmbedderConfig }
  | { ok: false; reason: 'no-model' | 'no-provider' | 'unknown-local-model' }

export type EmbedderAppDefaults = {
  embeddingModelId: string | null
  embeddingProviderId: string | null
  defaultStorySettings: { embeddingBackend?: 'local' | 'provider' }
}

// Trims before testing: the settings card already stores a blank provider model
// id as null, but this resolver is the gate every embed passes through, so it
// rejects whitespace itself rather than trusting that one caller.
function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * The dim a config's vectors would be READ at, or null when only an embed could
 * answer. A local config's dim is the catalog's; a provider config truncating to
 * the story's locked `effectiveDim` is read at that dim, and an untruncated
 * provider config is native — unknowable until it responds. Diverges from the
 * swap engine's `configStorageDim` on the truncating-provider-with-unknown-native
 * cell, where a staging run defers to the dim the server actually serves.
 */
export function embedderReadDim(config: EmbedderConfig): number | null {
  if (config.backend === 'local' || config.truncation == null) return config.dim
  return config.dim == null
    ? config.truncation.effectiveDim
    : Math.min(config.truncation.effectiveDim, config.dim)
}

export function resolveEmbedderConfig(
  story: Pick<
    StorySettings,
    'embeddingBackend' | 'embedding_model_id' | 'embedding_provider_id' | 'effectiveDim'
  > | null,
  app: EmbedderAppDefaults,
  opts?: { providerDim?: number; matryoshkaSupported?: boolean },
): EmbedderConfigResolution {
  const backend =
    story !== null ? story.embeddingBackend : (app.defaultStorySettings.embeddingBackend ?? 'local')
  const modelId = story !== null ? story.embedding_model_id : app.embeddingModelId
  const providerId = story !== null ? story.embedding_provider_id : app.embeddingProviderId

  if (backend === 'local') {
    if (!nonEmpty(modelId)) {
      return { ok: false, reason: 'no-model' }
    }
    const dim = localModelDim(modelId)
    if (dim === undefined) {
      return { ok: false, reason: 'unknown-local-model' }
    }
    return { ok: true, config: { backend: 'local', modelId, dim } }
  }

  if (!nonEmpty(providerId)) {
    return { ok: false, reason: 'no-provider' }
  }
  if (!nonEmpty(modelId)) {
    return { ok: false, reason: 'no-model' }
  }
  // null = unknown until first embed; the facade skips the dim check for it.
  const dim = opts?.providerDim ?? null
  const effectiveDim = story?.effectiveDim ?? null
  return {
    ok: true,
    config: {
      backend: 'provider',
      providerId,
      modelId,
      dim,
      truncation:
        effectiveDim != null
          ? { effectiveDim, serverSide: opts?.matryoshkaSupported ?? false }
          : null,
    },
  }
}
