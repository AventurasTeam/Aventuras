import { z } from 'zod'

import { createFetchWithCapture } from './transport/fetch'
import type { ProviderInstanceWithStub } from './types'

const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

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
