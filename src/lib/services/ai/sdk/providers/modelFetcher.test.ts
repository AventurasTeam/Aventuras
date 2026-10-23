import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProviderType } from '#lib/types/index.ts'

const requested = vi.hoisted(() => [] as string[])

vi.mock('./fetch', () => ({
  createTimeoutFetch: vi.fn(() => async (url: string) => {
    requested.push(url)
    return new Response(
      JSON.stringify({
        data: [{ id: 'm', subscription: { included: true } }],
        models: [{ name: 'models/m' }],
      }),
    )
  }),
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { fetchModelsFromProvider } from './modelFetcher'

const NORMALIZED = 'https://normalized.test/v1'
const RAW = ' https://raw.test/v1// '

beforeEach(() => {
  vi.clearAllMocks()
  requested.length = 0
})

describe('fetchModelsFromProvider base URL', () => {
  it.each<[ProviderType, string]>([
    ['openai-compatible', `${NORMALIZED}/models`],
    ['openrouter', `${NORMALIZED}/models`],
    ['nanogpt', `${NORMALIZED}/models?detailed=true`],
    ['nvidia-nim', `${NORMALIZED}/models`],
    ['anthropic', `${NORMALIZED}/models`],
    ['google', `${NORMALIZED}/models?key=k&pageSize=200`],
    ['zhipu', `${NORMALIZED}/models`],
    ['mistral', `${NORMALIZED}/models`],
  ])('requests the normalized base URL for %s', async (providerType, expected) => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce(NORMALIZED)

    await fetchModelsFromProvider(providerType, RAW, 'k')

    expect(normalizeBaseUrl).toHaveBeenCalledWith(RAW)
    expect(requested).toEqual([expected])
  })

  it('falls back to the provider default when the base URL normalizes to nothing', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('')

    await fetchModelsFromProvider('mistral', RAW, 'k')

    expect(requested).toEqual(['https://api.mistral.ai/v1/models'])
  })
})

describe('Ollama model listing', () => {
  it.each([
    [undefined, 'http://localhost:11434/api/tags'],
    ['http://box:11434/v1', 'http://box:11434/api/tags'],
    ['http://box:11434/api', 'http://box:11434/api/tags'],
    ['http://box:11434', 'http://box:11434/api/tags'],
  ])('given %j requests %s', async (baseUrl, expected) => {
    await fetchModelsFromProvider('ollama', baseUrl)
    expect(requested).toEqual([expected])
  })
})
