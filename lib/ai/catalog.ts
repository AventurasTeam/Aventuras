import { z } from 'zod'

import type { ProviderInstance } from '../db'
import { createFetchWithCapture } from './transport/fetch'
import type { ProviderInstanceWithStub } from './types'

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

type CachedModel = NonNullable<ProviderInstance['cachedModels']>[number]
type ProviderCapabilities = NonNullable<CachedModel['capabilities']>

// Best-effort, id-pattern detection only — providers rarely expose a
// structured capability flag over /models. False negatives fall back to the
// Memory-tab picker's free-text entry; false positives are rare (embed/
// almost never appears in a non-embedding model id).
function detectCapabilities(modelId: string): ProviderCapabilities {
  const capabilities: ProviderCapabilities = {}
  if (/embed/i.test(modelId)) capabilities.embedding = true
  return capabilities
}

/**
 * Normalize a /models id list into `cachedModels` entries, merging
 * best-effort detection with any previously cached entry. User-set
 * capability overrides (surfaced in App Settings · Providers · Models) always
 * win over a fresh detection pass — detection only fills gaps the user
 * hasn't touched.
 */
export function normalizeModelCatalog(ids: string[], existing?: CachedModel[]): CachedModel[] {
  const existingById = new Map((existing ?? []).map((model) => [model.id, model]))
  return ids.map((id) => {
    const capabilities = { ...detectCapabilities(id), ...existingById.get(id)?.capabilities }
    return Object.keys(capabilities).length > 0 ? { id, capabilities } : { id }
  })
}

function joinModelsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/models`
}

export async function fetchModelCatalog(
  provider: ProviderInstanceWithStub,
  opts?: { fetchImpl?: typeof fetch },
): Promise<string[]> {
  const endpoint = provider.endpoint?.trim()
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error(`Provider "${provider.id}" requires an endpoint to fetch a model catalog`)
  }
  const fetchWithCapture = createFetchWithCapture({
    source: `provider:${provider.id}`,
    ...(opts?.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  })
  const response = await fetchWithCapture(joinModelsUrl(endpoint), {
    method: 'GET',
    // Keyless local endpoints (LM Studio, llama.cpp) omit auth rather than send
    // a bare `Bearer `; mirrors createOpenAICompatible's own header construction.
    // TODO: Revisit when adding other providers.
    headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
  })
  if (!response.ok) {
    throw new Error(`Model catalog fetch failed: ${response.status}`)
  }
  const parsed = catalogSchema.parse(await response.json())
  return parsed.data.map((m) => m.id)
}
