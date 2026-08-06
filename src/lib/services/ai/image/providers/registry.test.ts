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

import { supportsImageGeneration, generateImage } from './registry'
import { settings } from '$lib/stores/settings.svelte'
import type { ImageProviderType } from '$lib/types'

describe('Image Provider Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('supportsImageGeneration', () => {
    // Exhaustive, so a provider added to the union but never registered fails here.
    const ALL_PROVIDERS: ImageProviderType[] = [
      'nanogpt',
      'openai',
      'openrouter',
      'chutes',
      'pollinations',
      'google',
      'zhipu',
      'comfyui',
      'a1111',
    ]

    it.each(ALL_PROVIDERS)('returns true for %s', (providerType) => {
      expect(supportsImageGeneration(providerType)).toBe(true)
    })

    it('returns false for unknown providers', () => {
      expect(supportsImageGeneration('unknown-provider')).toBe(false)
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
