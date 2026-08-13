import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    getImageProfile: vi.fn(),
    apiSettings: {
      llmTimeoutMs: 30000,
    },
  },
}))

vi.mock('$lib/stores/debug.svelte', () => ({
  debugStore: {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
  },
}))

import { supportsImageGeneration, requiresApiKey, generateImage } from './registry'
import { settings } from '$lib/stores/settings.svelte'
import type { ImageProviderType } from '$lib/types'

describe('Image Provider Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('supportsImageGeneration', () => {
    // A `Record` over the union, not an array: an array annotated `ImageProviderType[]`
    // accepts a short list happily, so the exhaustiveness this claims was never checked.
    // As a record, a provider added to the union and left out here fails `svelte-check`.
    const ALL_PROVIDERS: Record<ImageProviderType, true> = {
      nanogpt: true,
      openai: true,
      openrouter: true,
      chutes: true,
      pollinations: true,
      google: true,
      zhipu: true,
      comfyui: true,
      a1111: true,
    }

    it.each(Object.keys(ALL_PROVIDERS) as ImageProviderType[])(
      'returns true for %s',
      (providerType) => {
        expect(supportsImageGeneration(providerType)).toBe(true)
      },
    )

    it('returns false for unknown providers', () => {
      expect(supportsImageGeneration('unknown-provider')).toBe(false)
    })
  })

  describe('requiresApiKey', () => {
    it.each(['comfyui', 'a1111'] as ImageProviderType[])(
      'returns false for the self-hosted provider %s',
      (providerType) => {
        expect(requiresApiKey(providerType)).toBe(false)
      },
    )

    it.each([
      'nanogpt',
      'openai',
      'openrouter',
      'chutes',
      'google',
      'zhipu',
      // Its model list is open, its generation is not.
      'pollinations',
    ] as ImageProviderType[])('returns true for the hosted provider %s', (providerType) => {
      expect(requiresApiKey(providerType)).toBe(true)
    })

    it('assumes an unknown provider needs a key', () => {
      expect(requiresApiKey('unknown-provider')).toBe(true)
    })
  })

  describe('generateImage', () => {
    it('throws error if profile is not found', async () => {
      vi.mocked(settings.getImageProfile).mockReturnValue(undefined)

      await expect(
        generateImage({
          profileId: 'non-existent-id',
          model: 'gpt-image-2',
          prompt: 'A futuristic city',
        }),
      ).rejects.toThrow('Image profile not found: non-existent-id')
    })
  })
})
