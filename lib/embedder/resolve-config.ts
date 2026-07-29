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
