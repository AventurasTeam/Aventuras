import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { APIProfile } from '#lib/types/index.ts'

const sdk = vi.hoisted(() => ({ config: [] as Record<string, unknown>[] }))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((config: Record<string, unknown>) => {
    sdk.config.push(config)
    return (id: string) => ({ id })
  }),
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn((config: Record<string, unknown>) => {
    sdk.config.push(config)
    return (id: string) => ({ id })
  }),
}))
vi.mock('./fetch', () => ({ createTimeoutFetch: vi.fn(() => 'FETCH') }))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { createModelFromProfile } from './registry'

const RAW = ' https://raw.test/v1// '

const create = (providerType: APIProfile['providerType'], baseUrl?: string) =>
  createModelFromProfile({
    profile: { providerType, baseUrl, apiKey: 'k' } as APIProfile,
    modelId: 'm',
    presetId: 'preset',
  })

beforeEach(() => {
  vi.clearAllMocks()
  sdk.config.length = 0
})

describe('createModelFromProfile base URL', () => {
  it.each(['openai', 'openai-compatible'] as const)(
    'gives the SDK the normalized base URL for %s',
    (providerType) => {
      vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v1')

      create(providerType, RAW)

      expect(normalizeBaseUrl).toHaveBeenCalledWith(RAW)
      expect(sdk.config[0].baseURL).toBe('https://normalized.test/v1')
    },
  )

  it('falls back to the provider default when the base URL normalizes to nothing', () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('')

    create('openai', RAW)

    expect(sdk.config[0].baseURL).toBe('https://api.openai.com/v1')
  })

  it('still requires a base URL for openai-compatible', () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('')

    expect(() => create('openai-compatible', RAW)).toThrow('requires a custom base URL')
  })
})
