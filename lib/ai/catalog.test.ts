import { describe, expect, it } from 'vitest'

import { fetchModelCatalog } from './catalog'
import type { ProviderInstanceWithStub } from './types'

const provider: ProviderInstanceWithStub = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'sk-local',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchModelCatalog', () => {
  it('fetches GET {endpoint}/models and returns bare model ids', async () => {
    let calledUrl = ''
    const fetchImpl: typeof fetch = async (input) => {
      calledUrl = new Request(input).url
      return jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
    }
    const ids = await fetchModelCatalog(provider, { fetchImpl })
    expect(calledUrl).toBe('http://localhost:1234/v1/models')
    expect(ids).toEqual(['model-a', 'model-b'])
  })

  it('sends a bearer auth header when an api key is set', async () => {
    let authHeader: string | null = null
    const fetchImpl: typeof fetch = async (input) => {
      authHeader = new Request(input).headers.get('authorization')
      return jsonResponse({ data: [] })
    }
    await fetchModelCatalog(provider, { fetchImpl })
    expect(authHeader).toBe('Bearer sk-local')
  })

  it('omits the auth header for a keyless endpoint', async () => {
    let hasAuth = true
    const fetchImpl: typeof fetch = async (input) => {
      hasAuth = new Request(input).headers.has('authorization')
      return jsonResponse({ data: [] })
    }
    await fetchModelCatalog({ ...provider, apiKey: '' }, { fetchImpl })
    expect(hasAuth).toBe(false)
  })

  it('throws a clear error when the endpoint is missing', async () => {
    await expect(fetchModelCatalog({ ...provider, endpoint: undefined })).rejects.toThrow(
      /endpoint/,
    )
  })
})
