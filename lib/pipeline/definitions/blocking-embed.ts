import type { StorySettings } from '@/lib/db'
import { embedderReadDim, type EmbedderConfig } from '@/lib/embedder'
import { resolveStorySwapConfig } from '@/lib/embedder-swap'

import type { PhaseFailure } from '../types'

// One bound for a blocking embed: per-turn retrieval's and the close's range embed.
export const EMBED_TIMEOUT_MS = 300_000

// No usable embedder (unconfigured, or never probed for its dim): one tier, one envelope.
export function embedderInitFailure(detail: string): PhaseFailure {
  return { status: 'failed', error: { kind: 'embedder', reason: 'init', detail, staleCount: null } }
}

/** The story's embedder and its probed dim, or the init failure that ends the run. */
export function resolveStoryEmbedder(
  storyId: string,
  settings: StorySettings,
): { config: EmbedderConfig; dim: number } | PhaseFailure {
  const resolution = resolveStorySwapConfig(storyId, {
    modelId: settings.embedding_model_id,
    backend: settings.embeddingBackend,
    providerId: settings.embedding_provider_id,
  })
  if (!resolution.ok) return embedderInitFailure(`embedder not configured: ${resolution.reason}`)
  const dim = embedderReadDim(resolution.config)
  // Only an unprobed provider lands here. Guessing would KNN the wrong vec0 dim
  // family, which vec0 rejects with an opaque error rather than an empty result.
  if (dim === null)
    return embedderInitFailure(`embedder dim unknown for model ${resolution.config.modelId}`)
  return { config: resolution.config, dim }
}
