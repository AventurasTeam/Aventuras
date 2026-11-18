import { z } from 'zod'

import { isJsonObject } from '@/lib/json-object'

import type { ProviderInstance } from '../db'
import { createFetchWithCapture } from './transport/fetch'
import type { ProviderInstanceWithStub } from './types'

// Loose, so readContextWindow and readToolCalling see the fields the schema doesn't name.
const catalogSchema = z.object({
  data: z.array(z.looseObject({ id: z.string() })),
})

type CachedModel = NonNullable<ProviderInstance['cachedModels']>[number]
type ProviderCapabilities = NonNullable<CachedModel['capabilities']>

/** One `/models` entry: its id, and the generation window and tool support it published, if any. */
export type CatalogEntry = { id: string; contextWindow?: number; toolCalling?: boolean }

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

/** max_model_len, then meta.n_ctx; positive safe integers only (architecture.md → Detection). */
export function readContextWindow(raw: Record<string, unknown>): number | undefined {
  const { meta } = raw
  return asWindow(raw.max_model_len) ?? asWindow(isJsonObject(meta) ? meta.n_ctx : undefined)
}

// OpenRouter lists the request parameters each model accepts.
function supportedParameters(raw: Record<string, unknown>): readonly string[] | undefined {
  const value = raw.supported_parameters
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

/**
 * A catalog's published tool support (architecture.md → Detection); undefined where it publishes
 * none. OpenRouter's `tools` parameter is tool calling; `tool_choice` alone is not.
 */
export function readToolCalling(raw: Record<string, unknown>): boolean | undefined {
  const parameters = supportedParameters(raw)
  if (parameters !== undefined) return parameters.includes('tools')
  const { capabilities } = raw
  const flag = isJsonObject(capabilities) ? capabilities.function_calling : undefined
  return typeof flag === 'boolean' ? flag : undefined
}

/**
 * Later wins: id-pattern flags, the cached entry, then the published window and tool support; an
 * absent one keeps the stored value (architecture.md → Detection). A stored flag, even `false`,
 * beats the id pattern, so turn a flag off by storing `false`: a deleted key is re-detected on the
 * next refresh.
 */
export function normalizeModelCatalog(
  entries: readonly CatalogEntry[],
  existing?: readonly CachedModel[],
): CachedModel[] {
  const existingById = new Map((existing ?? []).map((model) => [model.id, model]))
  return entries.map(({ id, contextWindow, toolCalling }) => {
    const capabilities: ProviderCapabilities = {
      ...detectCapabilities(id),
      ...existingById.get(id)?.capabilities,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(toolCalling !== undefined ? { toolCalling } : {}),
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
    const toolCalling = readToolCalling(model)
    return {
      id: model.id,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(toolCalling !== undefined ? { toolCalling } : {}),
    }
  })
}
