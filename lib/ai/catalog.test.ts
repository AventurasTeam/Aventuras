import { describe, expect, it } from 'vitest'

import { fetchModelCatalog, normalizeModelCatalog, readContextWindow } from './catalog'
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

// A llama.cpp router's /models, trimmed: only a loaded model has `meta`, and `context_length` is
// the trained maximum, not the window the server runs the model at.
const ROUTER_CATALOG = {
  data: [
    {
      id: 'Gemma4-26B-A4B-QAT-MTP',
      object: 'model',
      owned_by: 'llamacpp',
      context_length: 262144,
      meta: { n_vocab: 262144, n_ctx: 65536, n_ctx_train: 262144 },
    },
    { id: 'Gemma4-26B', object: 'model', owned_by: 'llamacpp', context_length: 262144 },
  ],
}

describe('readContextWindow', () => {
  it('reads max_model_len', () => {
    expect(readContextWindow({ max_model_len: 32768 })).toBe(32768)
  })

  it('reads meta.n_ctx', () => {
    expect(readContextWindow({ meta: { n_ctx: 65536 } })).toBe(65536)
  })

  it('prefers max_model_len when both are published', () => {
    expect(readContextWindow({ max_model_len: 32768, meta: { n_ctx: 65536 } })).toBe(32768)
  })

  it('tries meta.n_ctx when max_model_len is not a positive integer', () => {
    expect(readContextWindow({ max_model_len: 0, meta: { n_ctx: 65536 } })).toBe(65536)
  })

  it.each([0, -5, 1.5, '65536', null, 2 ** 53])('ignores %s in either field', (value) => {
    expect(readContextWindow({ max_model_len: value })).toBeUndefined()
    expect(readContextWindow({ meta: { n_ctx: value } })).toBeUndefined()
  })

  it('never reads context_length', () => {
    expect(readContextWindow({ context_length: 262144 })).toBeUndefined()
  })

  it.each([undefined, null, 'loaded', [65536]])('reads nothing from a meta of %s', (meta) => {
    expect(readContextWindow({ meta })).toBeUndefined()
  })

  it("reads a router's loaded model by n_ctx, past context_length and n_ctx_train", () => {
    expect(readContextWindow(ROUTER_CATALOG.data[0])).toBe(65536)
  })
})

describe('fetchModelCatalog', () => {
  it('fetches GET {endpoint}/models and returns one entry per model', async () => {
    let calledUrl = ''
    const fetchImpl: typeof fetch = async (input) => {
      calledUrl = new Request(input).url
      return jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
    }
    const entries = await fetchModelCatalog(provider, { fetchImpl })
    expect(calledUrl).toBe('http://localhost:1234/v1/models')
    expect(entries).toStrictEqual([{ id: 'model-a' }, { id: 'model-b' }])
  })

  it("carries each entry's published window, read from fields the schema doesn't name", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(ROUTER_CATALOG)
    expect(await fetchModelCatalog(provider, { fetchImpl })).toStrictEqual([
      { id: 'Gemma4-26B-A4B-QAT-MTP', contextWindow: 65536 },
      { id: 'Gemma4-26B' },
    ])
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

describe('normalizeModelCatalog', () => {
  it('marks an embedding-shaped id detected, leaves a chat model bare', () => {
    expect(normalizeModelCatalog([{ id: 'text-embedding-3-small' }, { id: 'gpt-4o' }])).toEqual([
      { id: 'text-embedding-3-small', capabilities: { embedding: true } },
      { id: 'gpt-4o' },
    ])
  })

  it('preserves a user-set override over a fresh detection pass', () => {
    const result = normalizeModelCatalog(
      [{ id: 'text-embedding-3-small' }],
      [{ id: 'text-embedding-3-small', capabilities: { embedding: false } }],
    )
    expect(result).toEqual([{ id: 'text-embedding-3-small', capabilities: { embedding: false } }])
  })

  it('keeps other user-set capabilities while filling in the detected one', () => {
    const result = normalizeModelCatalog(
      [{ id: 'text-embedding-3-small' }],
      [{ id: 'text-embedding-3-small', capabilities: { reasoning: true } }],
    )
    expect(result).toEqual([
      { id: 'text-embedding-3-small', capabilities: { reasoning: true, embedding: true } },
    ])
  })

  it('stores a published window on a model seen for the first time', () => {
    expect(normalizeModelCatalog([{ id: 'gemma', contextWindow: 65536 }])).toEqual([
      { id: 'gemma', capabilities: { contextWindow: 65536 } },
    ])
  })

  it('replaces a stored window with a freshly published one, keeping the other keys', () => {
    const result = normalizeModelCatalog(
      [{ id: 'gemma', contextWindow: 65536 }],
      [{ id: 'gemma', capabilities: { contextWindow: 32768, reasoning: true } }],
    )
    expect(result).toEqual([
      { id: 'gemma', capabilities: { reasoning: true, contextWindow: 65536 } },
    ])
  })

  it('keeps the stored window when the fetch publishes none, as for an unloaded router model', () => {
    const result = normalizeModelCatalog(
      [{ id: 'gemma' }],
      [{ id: 'gemma', capabilities: { contextWindow: 65536 } }],
    )
    expect(result).toStrictEqual([{ id: 'gemma', capabilities: { contextWindow: 65536 } }])
  })

  it('keeps a stored embedding: false over detection while taking the fresh window', () => {
    const result = normalizeModelCatalog(
      [{ id: 'text-embedding-3-small', contextWindow: 8192 }],
      [{ id: 'text-embedding-3-small', capabilities: { embedding: false } }],
    )
    expect(result).toEqual([
      { id: 'text-embedding-3-small', capabilities: { embedding: false, contextWindow: 8192 } },
    ])
  })
})
