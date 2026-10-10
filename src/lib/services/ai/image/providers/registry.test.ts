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

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  imageGetFetch: vi.fn(),
  fetchImageBase64: vi.fn(),
}))

vi.mock('./openai', () => ({
  createOpenAIProvider: vi.fn(),
}))

vi.mock('./comfy', () => ({
  createComfyProvider: vi.fn(),
}))

vi.mock('./google', () => ({
  createGoogleProvider: vi.fn(),
}))

import { fetchImageBase64 } from './fetchAdapter'
import { createOpenAIProvider } from './openai'
import { createComfyProvider } from './comfy'
import { createGoogleProvider } from './google'
import type { ImageModelInfo } from './types'
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

    // The model list is cached per key, so each case gets its own.
    let keyCounter = 0
    function setup(providerType: 'openai' | 'google' | 'comfyui', models: ImageModelInfo[] = []) {
      const generate = vi.fn(async (_options: unknown) => ({ base64: 'RESULT' }))
      const provider = {
        id: providerType,
        name: providerType,
        generate,
        listModels: vi.fn(async () => models),
      }
      vi.mocked(createOpenAIProvider).mockReturnValue(provider)
      vi.mocked(createGoogleProvider).mockReturnValue(provider)
      vi.mocked(createComfyProvider).mockReturnValue(provider)
      vi.mocked(settings.getImageProfile).mockReturnValue({
        providerType,
        apiKey: `sk-key-${keyCounter++}`,
      } as ReturnType<typeof settings.getImageProfile>)
      vi.mocked(fetchImageBase64).mockResolvedValue('DOWNLOADED')
      return generate
    }

    it('hands adapters raw base64 for data: and http(s) references', async () => {
      const generate = setup('openai')

      await generateImage({
        profileId: 'p',
        model: 'gpt-image-1',
        prompt: 'x',
        referenceImages: [
          'data:image/png;base64,AAAA',
          'https://img.test/a.png',
          'data:application/octet-stream;base64,CCCC',
          'BBBB',
        ],
      })

      expect(fetchImageBase64).toHaveBeenCalledWith('https://img.test/a.png', expect.anything())
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['AAAA', 'DOWNLOADED', 'CCCC', 'BBBB'] }),
      )
    })

    it('trims references to the model limit before downloading any', async () => {
      const generate = setup('openai', [
        { id: 'dall-e-2', name: 'dall-e-2', supportsImg2Img: true, maxReferenceImages: 1 },
      ])

      await generateImage({
        profileId: 'p',
        model: 'dall-e-2',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png', 'https://img.test/b.png'],
      })

      expect(fetchImageBase64).toHaveBeenCalledTimes(1)
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['DOWNLOADED'] }),
      )
    })

    it('hands Google raw base64 references', async () => {
      const generate = setup('google')

      await generateImage({
        profileId: 'p',
        model: 'gemini-2.5-flash-image',
        prompt: 'x',
        referenceImages: ['data:image/png;base64,AAAA', 'https://img.test/a.png'],
      })

      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['AAAA', 'DOWNLOADED'] }),
      )
    })

    it('downloads no reference for a model that takes none', async () => {
      const generate = setup('google', [
        {
          id: 'imagen-4.0-generate-001',
          name: 'Imagen 4',
          supportsImg2Img: false,
          maxReferenceImages: 0,
        },
      ])

      await generateImage({
        profileId: 'p',
        model: 'imagen-4.0-generate-001',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png'],
      })

      expect(fetchImageBase64).not.toHaveBeenCalled()
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [] }))
    })

    it('sends no references, and downloads none, to a provider that ignores them', async () => {
      const generate = setup('comfyui')

      await generateImage({
        profileId: 'p',
        model: 'm',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png'],
      })

      expect(fetchImageBase64).not.toHaveBeenCalled()
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })

    it('passes no references when none were given', async () => {
      const generate = setup('openai')

      await generateImage({ profileId: 'p', model: 'gpt-image-1', prompt: 'x' })

      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })
  })
})
