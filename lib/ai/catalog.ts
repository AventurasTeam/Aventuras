import { z } from 'zod'

import type { ProviderInstance } from '../db'
import { createFetchWithCapture } from './transport/fetch'
import type { ProviderInstanceWithStub } from './types'

// Loose, so readContextWindow sees the fields the schema doesn't name.
const catalogSchema = z.object({
  data: z.array(z.looseObject({ id: z.string() })),
})

type CachedModel = NonNullable<ProviderInstance['cachedModels']>[number]
type ProviderCapabilities = NonNullable<CachedModel['capabilities']>

/** One `/models` entry: its id and the generation window it published, if any. */
export type CatalogEntry = { id: string; contextWindow?: number }

// Best-effort, id-pattern detection only — providers rarely expose a
// structured capability flag over /models. False negatives fall back to the
// Memory-tab picker's free-text entry; false positives are rare (embed/
// almost never appears in a non-embedding model id).
function detectCapabilities(modelId: string): ProviderCapabilities {
  const capabilities: ProviderCapabilities = {}
  if (/embed/i.test(modelId)) capabilities.embedding = true
  return capabilities
}

// Safe integers only: the capabilities schema's int() rejects larger ones, failing the whole save.
function asWindow(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nCtxOf(meta: unknown): unknown {
  return typeof meta === 'object' && meta !== null && 'n_ctx' in meta ? meta.n_ctx : undefined
}

/** max_model_len, then meta.n_ctx; positive safe integers only (architecture.md → Detection). */
export function readContextWindow(raw: Record<string, unknown>): number | undefined {
  return asWindow(raw.max_model_len) ?? asWindow(nCtxOf(raw.meta))
}

/**
 * Later wins: detection, the cached entry, then the published window; an absent window keeps the
 * stored one (architecture.md → The window figure). A stored key, even `false`, beats detection:
 * turn a flag off by storing `false`, not deleting the key, or the next refresh re-detects it.
 */
export function normalizeModelCatalog(
  entries: readonly CatalogEntry[],
  existing?: readonly CachedModel[],
): CachedModel[] {
  const existingById = new Map((existing ?? []).map((model) => [model.id, model]))
  return entries.map(({ id, contextWindow }) => {
    const capabilities: ProviderCapabilities = {
      ...detectCapabilities(id),
      ...existingById.get(id)?.capabilities,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    }
    return Object.keys(capabilities).length > 0 ? { id, capabilities } : { id }
  })
}

function joinModelsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/models`
}

export async function fetchModelCatalog(
  provider: ProviderInstanceWithStub,
  opts?: { fetchImpl?: typeof fetch },
): Promise<CatalogEntry[]> {
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
  return parsed.data.map((model) => {
    const contextWindow = readContextWindow(model)
    return contextWindow === undefined ? { id: model.id } : { id: model.id, contextWindow }
  })
}
