import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embedMany, type EmbeddingModel } from 'ai'

import {
  EmbedderCallError,
  EmbedderInitError,
  providerHasEmbeddingEndpoint,
  providerTypeSupportsEmbedding,
} from '@/lib/embedder'

import { classifyProviderError } from './transport/classify-provider-error'
import { createFetchWithCapture } from './transport/fetch'
import { type ProviderInstanceWithStub } from './types'

function requireEndpoint(provider: ProviderInstanceWithStub): string {
  if (!providerHasEmbeddingEndpoint(provider)) {
    throw new EmbedderInitError(
      `Provider "${provider.id}" (openai-compatible) requires an endpoint`,
    )
  }
  return provider.endpoint.trim()
}

function buildEmbeddingModel(
  provider: ProviderInstanceWithStub,
  modelId: string,
  actionId?: string,
): EmbeddingModel {
  // Same predicate the embedder gate consults, so a provider that passes the
  // gate can always be constructed here.
  if (!providerTypeSupportsEmbedding(provider.type)) {
    throw new EmbedderInitError(
      `Provider type "${provider.type}" does not support an embedding endpoint`,
    )
  }

  const fetchImpl = createFetchWithCapture({
    source: `provider:${provider.id}`,
    ...(actionId !== undefined ? { actionId } : {}),
  })

  const openaiCompatible = createOpenAICompatible({
    name: provider.displayName,
    apiKey: provider.apiKey,
    baseURL: requireEndpoint(provider),
    fetch: fetchImpl,
  })
  return openaiCompatible.textEmbeddingModel(modelId)
}

/**
 * Embed `texts` through `provider`'s configured embedding endpoint. Returns
 * raw vectors at the model's native dim — prefixing and Matryoshka
 * truncation are still the caller's job, not this transport. `dimensions` is
 * only a server-side hint (sent as `providerOptions.openaiCompatible.dimensions`
 * when the model honors OpenAI's Matryoshka `dimensions` param); client-side
 * truncation runs regardless, so correctness never depends on the server
 * honoring it.
 */
export async function embedViaProvider(
  provider: ProviderInstanceWithStub,
  modelId: string,
  texts: string[],
  actionId?: string,
  dimensions?: number,
  abortSignal?: AbortSignal,
): Promise<{ vectors: Float32Array[]; dim: number }> {
  const model = buildEmbeddingModel(provider, modelId, actionId)

  let embeddings: number[][]
  try {
    embeddings = (
      await embedMany({
        model,
        values: texts,
        ...(abortSignal != null ? { abortSignal } : {}),
        // Literal key, not the provider's display name: the SDK resolves its
        // lookup as `provider.split('.')[0].trim()` over `<displayName>.embedding`,
        // so any display name carrying a dot or padding (`api.openai.com`) would
        // silently drop the option. `openaiCompatible` is checked unconditionally.
        ...(dimensions != null ? { providerOptions: { openaiCompatible: { dimensions } } } : {}),
      })
    ).embeddings
  } catch (err) {
    const { error } = classifyProviderError(err)
    const message = error.detail ?? error.reason
    // Auth failure is a config problem, not a transient call failure — the
    // session can't embed at all until the key is fixed, so it surfaces at
    // Test Embedder like any other init error (see lib/embedder/types.ts).
    if (error.reason === 'auth') throw new EmbedderInitError(message, err)
    throw new EmbedderCallError(message, err)
  }

  const vectors = embeddings.map((values) => new Float32Array(values))
  const dim = vectors[0]?.length ?? 0
  if (vectors.some((vector) => vector.length !== dim)) {
    throw new EmbedderCallError('provider returned embedding vectors of mismatched dimension')
  }

  return { vectors, dim }
}
