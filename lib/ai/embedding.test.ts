import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmbedderCallError, EmbedderInitError } from '@/lib/embedder'

import { embedViaProvider } from './embedding'
import type { ProviderInstanceWithStub } from './types'

const provider: ProviderInstanceWithStub = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'sk-local',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

function embeddingsResponse(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({
      data: vectors.map((embedding) => ({ embedding, object: 'embedding' })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('embedViaProvider', () => {
  it('embeds texts via the openai-compatible embeddings endpoint, in order', async () => {
    let calledUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calledUrl = new Request(input).url
      return embeddingsResponse([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ])
    })

    const result = await embedViaProvider(provider, 'text-embedding-3-small', ['a', 'b'])

    expect(calledUrl).toBe('http://localhost:1234/v1/embeddings')
    expect(result.dim).toBe(3)
    expect(result.vectors).toHaveLength(2)
    expect(result.vectors[0]).toBeInstanceOf(Float32Array)
    expect(Array.from(result.vectors[0])).toEqual([0.1, 0.2, 0.3].map((n) => Math.fround(n)))
    expect(Array.from(result.vectors[1])).toEqual([0.4, 0.5, 0.6].map((n) => Math.fround(n)))
  })

  it('threads a dimensions param into providerOptions under the provider displayName key', async () => {
    let requestBody: unknown
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestBody = await new Request(input).json()
      return embeddingsResponse([[0.1, 0.2, 0.3, 0.4]])
    })

    await embedViaProvider(provider, 'text-embedding-3-small', ['a'], undefined, 4)

    expect(requestBody).toMatchObject({ dimensions: 4 })
  })

  it('omits the dimensions param from the request body when not passed', async () => {
    let requestBody: unknown
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestBody = await new Request(input).json()
      return embeddingsResponse([[0.1, 0.2, 0.3]])
    })

    await embedViaProvider(provider, 'text-embedding-3-small', ['a'])

    expect(requestBody).not.toHaveProperty('dimensions')
  })

  it('rejects anthropic providers with an init error (no embedding endpoint)', async () => {
    const anthropicProvider: ProviderInstanceWithStub = {
      id: 'prov-anthropic',
      type: 'anthropic',
      displayName: 'Anthropic',
      apiKey: 'sk-ant',
      favoriteModelIds: [],
    }

    let caught: unknown
    try {
      await embedViaProvider(anthropicProvider, 'claude-3-haiku-20240307', ['a'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedderInitError)
    expect((caught as EmbedderInitError).kind).toBe('init')
  })

  it('throws an init error when an openai-compatible provider is missing an endpoint', async () => {
    const missingEndpoint = { ...provider, endpoint: undefined }

    let caught: unknown
    try {
      await embedViaProvider(missingEndpoint, 'text-embedding-3-small', ['a'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedderInitError)
    expect((caught as EmbedderInitError).kind).toBe('init')
  })

  it('maps a 401 response to an init error, not a call error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    let caught: unknown
    try {
      await embedViaProvider(provider, 'text-embedding-3-small', ['a'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedderInitError)
    expect((caught as EmbedderInitError).kind).toBe('init')
  })

  it('maps a network failure during embedMany to a call error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    let caught: unknown
    try {
      await embedViaProvider(provider, 'text-embedding-3-small', ['a'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedderCallError)
    expect((caught as EmbedderCallError).kind).toBe('call')
  })

  it('throws a call error when the response returns mismatched vector dims', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      embeddingsResponse([
        [0.1, 0.2],
        [0.1, 0.2, 0.3],
      ]),
    )

    let caught: unknown
    try {
      await embedViaProvider(provider, 'text-embedding-3-small', ['a', 'b'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedderCallError)
    expect((caught as EmbedderCallError).kind).toBe('call')
  })
})
