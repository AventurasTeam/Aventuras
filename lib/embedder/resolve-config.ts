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

function nonEmpty(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

export function resolveEmbedderConfig(
  story: Pick<
    StorySettings,
    'embeddingBackend' | 'embedding_model_id' | 'embedding_provider_id'
  > | null,
  app: EmbedderAppDefaults,
  opts?: { providerDim?: number },
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
  // dim 0 = unknown until first embed; the service facade treats 0 as to-be-verified.
  const dim = opts?.providerDim ?? 0
  return { ok: true, config: { backend: 'provider', providerId, modelId, dim } }
}
