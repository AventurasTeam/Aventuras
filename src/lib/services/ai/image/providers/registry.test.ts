import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    getImageProfile: vi.fn(),
    apiSettings: {
      llmTimeoutMs: 30000,
    },
  },
}))

vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debugStore: {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
  },
}))

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  imageGetFetch: vi.fn(),
  fetchPublicImageBase64: vi.fn(),
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

import { fetchPublicImageBase64 } from './fetchAdapter'
import { createOpenAIProvider } from './openai'
import { createComfyProvider } from './comfy'
import { createGoogleProvider } from './google'
import type { ImageModelInfo } from './types'
import {
  supportsImageGeneration,
  requiresApiKey,
  takesApiKey,
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDER_OPTIONS,
  generateImage,
  supportsReferenceImages,
  listImageModels,
  listImageModelsByProvider,
} from './registry'
import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageProviderType } from '#lib/types/index.ts'

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
      'openai-compatible': true,
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
    it.each(['comfyui', 'a1111'] satisfies ImageProviderType[])(
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
    ] satisfies ImageProviderType[])('returns true for the hosted provider %s', (providerType) => {
      expect(requiresApiKey(providerType)).toBe(true)
    })

    it('does not require a key for OpenAI Compatible, which a proxy may leave open', () => {
      expect(requiresApiKey('openai-compatible')).toBe(false)
    })

    it('assumes an unknown provider needs a key', () => {
      expect(requiresApiKey('unknown-provider')).toBe(true)
    })
  })

  describe('takesApiKey', () => {
    it.each(['comfyui', 'a1111'] satisfies ImageProviderType[])(
      'is false for the self-hosted provider %s',
      (providerType) => {
        expect(takesApiKey(providerType)).toBe(false)
      },
    )

    it.each([
      'openai',
      'openai-compatible',
      'google',
      'pollinations',
    ] satisfies ImageProviderType[])('is true for %s', (providerType) => {
      expect(takesApiKey(providerType)).toBe(true)
    })

    it('assumes an unknown provider takes a key', () => {
      expect(takesApiKey('unknown-provider')).toBe(true)
    })
  })

  describe('IMAGE_PROVIDER_OPTIONS', () => {
    it('offers every provider once, under its label', () => {
      expect(IMAGE_PROVIDER_OPTIONS.map((o) => o.value).toSorted()).toEqual(
        Object.keys(IMAGE_PROVIDER_LABELS).toSorted(),
      )
      for (const { value, label } of IMAGE_PROVIDER_OPTIONS) {
        expect(label).toBe(IMAGE_PROVIDER_LABELS[value])
      }
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
      vi.mocked(fetchPublicImageBase64).mockResolvedValue('DOWNLOADED')
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

      expect(fetchPublicImageBase64).toHaveBeenCalledWith(
        'https://img.test/a.png',
        expect.anything(),
      )
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

      expect(fetchPublicImageBase64).toHaveBeenCalledTimes(1)
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['DOWNLOADED'] }),
      )
    })

    it('drops a reference that fails to download and keeps the rest', async () => {
      const generate = setup('openai')
      vi.mocked(fetchPublicImageBase64).mockImplementation(async (url) => {
        if (url.includes('bad')) throw new Error('Image URL does not point at a public host')
        return 'DOWNLOADED'
      })

      await generateImage({
        profileId: 'p',
        model: 'gpt-image-1',
        prompt: 'x',
        referenceImages: [
          'https://img.test/a.png',
          'http://bad.test/b.png',
          'data:image/png;base64,AAAA',
        ],
      })

      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['DOWNLOADED', 'AAAA'] }),
      )
    })

    it('generates without references when every one fails to download', async () => {
      const generate = setup('openai')
      vi.mocked(fetchPublicImageBase64).mockRejectedValue(new Error('refused'))

      await generateImage({
        profileId: 'p',
        model: 'gpt-image-1',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png', 'https://img.test/b.png'],
      })

      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [] }))
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
      const generate = setup('openai', [
        { id: 'dall-e-3', name: 'DALL·E 3', supportsImg2Img: false, maxReferenceImages: 0 },
      ])

      await generateImage({
        profileId: 'p',
        model: 'dall-e-3',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png'],
      })

      expect(fetchPublicImageBase64).not.toHaveBeenCalled()
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

      expect(fetchPublicImageBase64).not.toHaveBeenCalled()
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })

    it('passes no references when none were given', async () => {
      const generate = setup('openai')

      await generateImage({ profileId: 'p', model: 'gpt-image-1', prompt: 'x' })

      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })
  })

  describe('supportsReferenceImages', () => {
    let keyCounter = 0
    function setup(providerType: 'openai' | 'comfyui', models: ImageModelInfo[]) {
      const provider = {
        id: providerType,
        name: providerType,
        generate: vi.fn(),
        listModels: vi.fn(async () => models),
      }
      vi.mocked(createOpenAIProvider).mockReturnValue(provider)
      vi.mocked(createComfyProvider).mockReturnValue(provider)
      vi.mocked(settings.getImageProfile).mockReturnValue({
        providerType,
        apiKey: `sk-ref-${keyCounter++}`,
      } as ReturnType<typeof settings.getImageProfile>)
    }

    it('is false for a provider that does not read references', async () => {
      setup('comfyui', [])
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it('is false for a model marked as lacking img2img', async () => {
      setup('openai', [{ id: 'm', name: 'm', supportsImg2Img: false }])
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it('is true for a model that supports img2img', async () => {
      setup('openai', [{ id: 'm', name: 'm', supportsImg2Img: true }])
      expect(await supportsReferenceImages('p', 'm')).toBe(true)
    })

    it('passes a model absent from the list', async () => {
      setup('openai', [{ id: 'other', name: 'other', supportsImg2Img: false }])
      expect(await supportsReferenceImages('p', 'm')).toBe(true)
    })

    it('is false for an unknown profile', async () => {
      vi.mocked(settings.getImageProfile).mockReturnValue(undefined)
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })
  })
  describe('model listing failures', () => {
    function failingProvider() {
      vi.mocked(createOpenAIProvider).mockReturnValue({
        id: 'openai',
        name: 'openai',
        generate: vi.fn(),
        listModels: vi.fn(async () => {
          throw new Error('Image API error 401: bad key')
        }),
      })
    }

    it('rethrows from listImageModelsByProvider so the profile form can show it', async () => {
      failingProvider()
      await expect(listImageModelsByProvider('openai', 'sk-fail-a', true)).rejects.toThrow(
        'bad key',
      )
    })

    it('swallows in listImageModels and does not cache the failure', async () => {
      failingProvider()
      vi.mocked(settings.getImageProfile).mockReturnValue({
        providerType: 'openai',
        apiKey: 'sk-fail-b',
      } as ReturnType<typeof settings.getImageProfile>)
      expect(await listImageModels('p')).toEqual([])

      const listModels = vi.fn(async () => [{ id: 'm', name: 'm', supportsImg2Img: true }])
      vi.mocked(createOpenAIProvider).mockReturnValue({
        id: 'openai',
        name: 'openai',
        generate: vi.fn(),
        listModels,
      })
      expect(await listImageModels('p')).toHaveLength(1)
      expect(listModels).toHaveBeenCalledTimes(1)
    })
  })
})
