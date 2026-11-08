import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    getImageProfile: vi.fn(),
    updateImageProfile: vi.fn(),
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
  imageGetFetch: vi.fn(),
  fetchPublicImageBase64: vi.fn(),
}))

vi.mock('./openai', () => ({
  createOpenAIProvider: vi.fn(),
  openaiModelCapabilities: vi.fn(),
}))

vi.mock('./openrouter', () => ({
  createOpenRouterProvider: vi.fn(),
}))

vi.mock('./openaiCompatibleProvider', () => ({
  createOpenAICompatibleProvider: vi.fn(),
}))

vi.mock('./zhipu', () => ({
  createZhipuProvider: vi.fn(),
}))

vi.mock('./comfy', () => ({
  createComfyProvider: vi.fn(),
  comfyReferenceLimit: vi.fn(),
}))

vi.mock('./a1111', () => ({
  createA1111Provider: vi.fn(),
  a1111ReferenceLimit: (options: { takesReferences?: boolean }) =>
    options.takesReferences === true ? Infinity : 0,
}))

vi.mock('./google', () => ({
  createGoogleProvider: vi.fn(),
  googleModelCapabilities: vi.fn(),
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { fetchPublicImageBase64 } from './fetchAdapter'
import { createOpenAIProvider, openaiModelCapabilities } from './openai'
import { createOpenRouterProvider } from './openrouter'
import { createOpenAICompatibleProvider } from './openaiCompatibleProvider'
import { createZhipuProvider } from './zhipu'
import { comfyReferenceLimit, createComfyProvider } from './comfy'
import { createA1111Provider } from './a1111'
import { createGoogleProvider, googleModelCapabilities } from './google'
import type { ImageModelInfo, ImageProvider } from './types'
import { imageConnectionFor } from './connection'
import {
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDER_OPTIONS,
  generateImage,
  supportsReferenceImages,
  listImageModels,
  evictReplacedModelList,
  warmImageCapabilities,
} from './registry'
import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageModelCapabilities, ImageProfile, ImageProviderType } from '#lib/types/index.ts'

const conn = (providerType: ImageProviderType, apiKey: string, baseUrl?: string) =>
  imageConnectionFor(providerType, apiKey, baseUrl)

const adapter = (listModels: ImageProvider['listModels']): ImageProvider => ({
  id: 'openai',
  name: 'openai',
  generate: vi.fn(),
  listModels,
})

describe('Image Provider Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(comfyReferenceLimit).mockReturnValue(0)
    vi.mocked(openaiModelCapabilities).mockReturnValue(undefined)
    vi.mocked(googleModelCapabilities).mockReturnValue(undefined)
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
    function setup(
      providerType: 'openai' | 'openrouter' | 'google' | 'comfyui' | 'a1111',
      models: ImageModelInfo[] = [],
      providerOptions: Record<string, unknown> = {},
    ) {
      const generate = vi.fn(async (_options: unknown) => ({ base64: 'RESULT' }))
      const provider = {
        id: providerType,
        name: providerType,
        generate,
        listModels: vi.fn(async () => models),
      }
      vi.mocked(createOpenAIProvider).mockReturnValue(provider)
      vi.mocked(createOpenRouterProvider).mockReturnValue(provider)
      vi.mocked(createGoogleProvider).mockReturnValue(provider)
      vi.mocked(createComfyProvider).mockReturnValue(provider)
      vi.mocked(createA1111Provider).mockReturnValue(provider)
      vi.mocked(settings.getImageProfile).mockReturnValue({
        providerType,
        apiKey: `sk-key-${keyCounter++}`,
        providerOptions,
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
      const generate = setup('openrouter', [
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
      const generate = setup('openrouter', [
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

    it('sends no references, and downloads none, to a ComfyUI workflow that has no LoadImage', async () => {
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

    it('hands ComfyUI as many references as its workflow has selected inputs', async () => {
      const generate = setup('comfyui')
      vi.mocked(comfyReferenceLimit).mockReturnValue(1)

      await generateImage({
        profileId: 'p',
        model: 'm',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png', 'https://img.test/b.png'],
      })

      expect(fetchPublicImageBase64).toHaveBeenCalledTimes(1)
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['DOWNLOADED'] }),
      )
    })

    it('sends no references, and downloads none, to A1111 with the switch off', async () => {
      const generate = setup('a1111')

      await generateImage({
        profileId: 'p',
        model: 'm',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png'],
      })

      expect(fetchPublicImageBase64).not.toHaveBeenCalled()
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })

    it('hands A1111 references with the switch on', async () => {
      const generate = setup('a1111', [], { takesReferences: true })

      await generateImage({
        profileId: 'p',
        model: 'm',
        prompt: 'x',
        referenceImages: ['https://img.test/a.png'],
      })

      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceImages: ['DOWNLOADED'] }),
      )
    })

    it('passes no references when none were given', async () => {
      const generate = setup('openai')

      await generateImage({ profileId: 'p', model: 'gpt-image-1', prompt: 'x' })

      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: undefined }))
    })
  })

  describe('supportsReferenceImages', () => {
    let keyCounter = 0
    function setup(
      providerType: ImageProviderType,
      models: ImageModelInfo[] = [],
      providerOptions: Record<string, unknown> = {},
    ) {
      const provider = {
        id: providerType,
        name: providerType,
        generate: vi.fn(),
        listModels: vi.fn(async () => models),
      }
      vi.mocked(createOpenAIProvider).mockReturnValue(provider)
      vi.mocked(createOpenRouterProvider).mockReturnValue(provider)
      vi.mocked(createComfyProvider).mockReturnValue(provider)
      vi.mocked(createA1111Provider).mockReturnValue(provider)
      vi.mocked(settings.getImageProfile).mockReturnValue({
        providerType,
        apiKey: `sk-ref-${keyCounter++}`,
        providerOptions,
      } as ReturnType<typeof settings.getImageProfile>)
    }

    it('is false for ComfyUI without a workflow that takes references', async () => {
      setup('comfyui')
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it('is true for ComfyUI with one', async () => {
      setup('comfyui')
      vi.mocked(comfyReferenceLimit).mockReturnValue(1)
      expect(await supportsReferenceImages('p', 'm')).toBe(true)
    })

    it('is false for Z.AI', async () => {
      setup('zhipu')
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it.each([
      [{}, false],
      [{ takesReferences: true }, true],
    ])('for A1111 with %j is %s', async (providerOptions, expected) => {
      setup('a1111', [], providerOptions)
      expect(await supportsReferenceImages('p', 'm')).toBe(expected)
    })

    it('is false for a model marked as lacking img2img', async () => {
      setup('openrouter', [{ id: 'm', name: 'm', supportsImg2Img: false }])
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it('is true for a model that supports img2img', async () => {
      setup('openrouter', [{ id: 'm', name: 'm', supportsImg2Img: true }])
      expect(await supportsReferenceImages('p', 'm')).toBe(true)
    })

    it('passes a model absent from the list', async () => {
      setup('openrouter', [{ id: 'other', name: 'other', supportsImg2Img: false }])
      expect(await supportsReferenceImages('p', 'm')).toBe(true)
    })

    it('is false for an unknown profile', async () => {
      vi.mocked(settings.getImageProfile).mockReturnValue(undefined)
      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    describe('capability override', () => {
      let overrideCounter = 0
      function overrideSetup(
        providerType: 'openai-compatible' | 'openrouter',
        over: Partial<ImageProfile>,
        listed: ImageModelInfo,
      ) {
        const provider = {
          id: providerType,
          name: providerType,
          generate: vi.fn(),
          listModels: vi.fn(async () => [listed]),
        }
        vi.mocked(createOpenAICompatibleProvider).mockReturnValue(provider)
        vi.mocked(createOpenRouterProvider).mockReturnValue(provider)
        vi.mocked(settings.getImageProfile).mockReturnValue({
          providerType,
          apiKey: `sk-override-${overrideCounter++}`,
          model: 'm',
          providerOptions: {},
          ...over,
        } as ImageProfile)
        return provider
      }
      const listed = (over: Partial<ImageModelInfo>): ImageModelInfo => ({
        id: 'm',
        name: 'm',
        supportsImg2Img: true,
        ...over,
      })

      it('turns references off over a model the list says takes them', async () => {
        overrideSetup(
          'openai-compatible',
          { capabilityOverride: { references: false } },
          listed({}),
        )
        expect(await supportsReferenceImages('p', 'm')).toBe(false)
      })

      it('sends no reference to a profile whose override turns references off', async () => {
        const provider = overrideSetup(
          'openai-compatible',
          { capabilityOverride: { references: false } },
          listed({}),
        )

        await generateImage({
          profileId: 'p',
          model: 'm',
          prompt: 'x',
          referenceImages: ['https://img.test/a.png'],
        })

        expect(fetchPublicImageBase64).not.toHaveBeenCalled()
        expect(provider.generate).toHaveBeenCalledWith(
          expect.objectContaining({ referenceImages: [] }),
        )
      })

      it('turns references on over a model the list says lacks them', async () => {
        overrideSetup(
          'openai-compatible',
          { capabilityOverride: { references: true } },
          listed({ supportsImg2Img: false }),
        )
        expect(await supportsReferenceImages('p', 'm')).toBe(true)
      })

      it('names the override when it leaves a model that needs a reference without one', async () => {
        overrideSetup(
          'openai-compatible',
          { capabilityOverride: { references: false } },
          listed({ requiresReferenceImage: true }),
        )
        await expect(generateImage({ profileId: 'p', model: 'm', prompt: 'x' })).rejects.toThrow(
          'References override is Off',
        )
      })

      it('is ignored by a provider that takes none', async () => {
        overrideSetup('openrouter', { capabilityOverride: { references: false } }, listed({}))
        expect(await supportsReferenceImages('p', 'm')).toBe(true)
      })
    })
  })

  describe('model capabilities', () => {
    // The capability cache and the model cache outlive a test, so each case gets its own key.
    let counter = 0
    function setup(
      over: Partial<ImageProfile> = {},
      {
        listModels = vi.fn(async (): Promise<ImageModelInfo[]> => []),
        getModelCapabilities,
      }: {
        listModels?: (signal?: AbortSignal) => Promise<ImageModelInfo[]>
        getModelCapabilities?: (
          model: string,
          listed: ImageModelInfo[],
          signal?: AbortSignal,
        ) => Promise<ImageModelCapabilities | undefined>
      } = {},
    ) {
      const n = counter++
      const generate = vi.fn(async (_options: unknown) => ({ base64: 'RESULT' }))
      vi.mocked(createOpenRouterProvider).mockReturnValue({
        id: 'openrouter',
        name: 'openrouter',
        generate,
        listModels,
        getModelCapabilities,
      })
      const profile = {
        id: `caps-${n}`,
        providerType: 'openrouter',
        apiKey: `sk-caps-${n}`,
        model: 'm',
        providerOptions: {},
        ...over,
      } as ImageProfile
      vi.mocked(settings.getImageProfile).mockReturnValue(profile)
      vi.mocked(fetchPublicImageBase64).mockResolvedValue('DOWNLOADED')
      return { profile, generate, listModels }
    }

    const generate = (model = 'm', referenceImages?: string[]) =>
      generateImage({ profileId: 'p', model, prompt: 'x', referenceImages })

    it('reads the model from the list once, and saves nothing to the profile', async () => {
      const { generate: send, listModels } = setup(
        {},
        {
          listModels: vi.fn(async () => [
            { id: 'm', name: 'm', supportsImg2Img: true, maxReferenceImages: 1 },
          ]),
        },
      )

      await generate('m', ['https://img.test/a.png', 'https://img.test/b.png'])
      await generate()

      expect(listModels).toHaveBeenCalledTimes(1)
      expect(fetchPublicImageBase64).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 1 }),
        }),
      )
      expect(settings.updateImageProfile).not.toHaveBeenCalled()
    })

    it('remembers a model the list does not know', async () => {
      const { listModels } = setup(
        {},
        { listModels: vi.fn(async () => [{ id: 'other', name: 'other' }]) },
      )

      await generate()
      await generate()

      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('still generates from an empty list, and does not ask again for a few minutes', async () => {
      vi.useFakeTimers()
      try {
        const getModelCapabilities = vi.fn(async (): Promise<undefined> => undefined)
        const { generate: send } = setup({}, { getModelCapabilities })

        await generate()
        await generate()
        expect(send).toHaveBeenCalledTimes(2)
        expect(getModelCapabilities).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
        await generate()
        expect(getModelCapabilities).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('reads a listed model from a loaded list without asking the provider', async () => {
      const getModelCapabilities = vi.fn(async () => ({ supportedAspectRatios: ['1:1'] }))
      const {
        profile,
        generate: send,
        listModels,
      } = setup(
        {},
        {
          listModels: vi.fn(async () => [{ id: 'm', name: 'm', maxReferenceImages: 2 }]),
          getModelCapabilities,
        },
      )

      await listImageModels(profile, true)
      await generate()

      expect(listModels).toHaveBeenCalledTimes(1)
      expect(getModelCapabilities).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 2 }),
        }),
      )
    })

    it('prefers a reloaded list to the answer a lookup was still fetching for the old one', async () => {
      let finish: (value: ImageModelCapabilities) => void = () => {}
      const getModelCapabilities = vi.fn(
        () => new Promise<ImageModelCapabilities | undefined>((resolve) => (finish = resolve)),
      )
      const listModels = vi
        .fn<() => Promise<ImageModelInfo[]>>()
        .mockResolvedValueOnce([{ id: 'other', name: 'other' }])
        .mockResolvedValue([{ id: 'm', name: 'm', maxReferenceImages: 5 }])
      const { profile, generate: send } = setup({}, { listModels, getModelCapabilities })

      const slow = generate()
      await vi.waitFor(() => expect(getModelCapabilities).toHaveBeenCalled())
      await listImageModels(profile, true)
      finish({ maxReferenceImages: 1 })
      await slow
      await generate()

      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 5 }),
        }),
      )
    })

    it('stops waiting for capabilities when generation is cancelled', async () => {
      vi.useFakeTimers()
      try {
        const { generate: send } = setup(
          {},
          { listModels: vi.fn(() => new Promise<ImageModelInfo[]>(() => {})) },
        )
        const controller = new AbortController()
        const reason = new DOMException('Stopped', 'AbortError')

        const done = generateImage({
          profileId: 'p',
          model: 'm',
          prompt: 'x',
          signal: controller.signal,
        })
        controller.abort(reason)

        await expect(done).rejects.toBe(reason)
        expect(send).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(10_000)
      } finally {
        vi.useRealTimers()
      }
    })

    it('cancels a list request that outlasts the lookup bound, and still generates', async () => {
      vi.useFakeTimers()
      try {
        let listSignal: AbortSignal | undefined
        const { generate: send } = setup(
          {},
          {
            listModels: vi.fn((signal?: AbortSignal) => {
              listSignal = signal
              return new Promise<ImageModelInfo[]>(() => {})
            }),
          },
        )

        const done = generate()
        await vi.advanceTimersByTimeAsync(10_000)
        await done

        expect(listSignal?.aborted).toBe(true)
        expect((listSignal?.reason as Error).name).toBe('AbortError')
        expect(send).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('refuses a model that edits only when no reference could be sent', async () => {
      const { generate: send } = setup(
        {},
        {
          listModels: vi.fn(async () => [{ id: 'm', name: 'm', requiresReferenceImage: true }]),
        },
      )
      vi.mocked(fetchPublicImageBase64).mockRejectedValue(new Error('refused'))

      await expect(generate()).rejects.toThrow('needs a reference image')
      await expect(generate('m', ['https://img.test/a.png'])).rejects.toThrow(
        'needs a reference image',
      )
      expect(send).not.toHaveBeenCalled()
    })

    it('asks a provider for a model its list lacks', async () => {
      const getModelCapabilities = vi.fn(async () => ({ supportedAspectRatios: ['1:1'] }))
      const { generate: send, listModels } = setup({}, { getModelCapabilities })

      await generate()

      expect(listModels).toHaveBeenCalledTimes(1)
      expect(getModelCapabilities).toHaveBeenCalledWith('m', [], expect.any(AbortSignal))
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ supportedAspectRatios: ['1:1'] }),
        }),
      )
    })

    it('prefers the listed entry to the provider’s own lookup', async () => {
      const getModelCapabilities = vi.fn(async () => ({ supportedAspectRatios: ['1:1'] }))
      const { generate: send } = setup(
        {},
        {
          listModels: vi.fn(async () => [{ id: 'm', name: 'm', maxReferenceImages: 2 }]),
          getModelCapabilities,
        },
      )

      await generate()

      expect(getModelCapabilities).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 2 }),
        }),
      )
    })

    it('finds a model listed under an alias', async () => {
      const { generate: send } = setup(
        {},
        {
          listModels: vi.fn(async () => [
            { id: 'canonical', name: 'c', aliases: ['m'], maxReferenceImages: 3 },
          ]),
        },
      )

      await generate()

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 3 }),
        }),
      )
    })

    it('generates without capabilities when the provider lookup fails', async () => {
      const getModelCapabilities = vi.fn(async (): Promise<undefined> => {
        throw new Error('503')
      })
      const { generate: send } = setup({}, { getModelCapabilities })

      await generate()

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: undefined }))
    })

    it('reads the list in supportsReferenceImages', async () => {
      setup({}, { listModels: vi.fn(async () => [{ id: 'm', name: 'm', supportsImg2Img: false }]) })

      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it('looks the model up again after the list is reloaded', async () => {
      const listModels = vi
        .fn<() => Promise<ImageModelInfo[]>>()
        .mockResolvedValueOnce([{ id: 'm', name: 'm', maxReferenceImages: 1 }])
        .mockResolvedValue([{ id: 'm', name: 'm', maxReferenceImages: 5 }])
      const { profile, generate: send } = setup({}, { listModels })

      await generate()
      await listImageModels(profile, true)
      await generate()

      expect(send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          modelInfo: expect.objectContaining({ maxReferenceImages: 5 }),
        }),
      )
    })

    it('looks the model up again when the profile moves to another connection', async () => {
      const { profile, listModels } = setup(
        {},
        { listModels: vi.fn(async () => [{ id: 'm', name: 'm' }]) },
      )

      await generate()
      evictReplacedModelList(profile, conn('openrouter', 'sk-caps-moved'))
      await generate()

      expect(listModels).toHaveBeenCalledTimes(2)
    })
  })

  describe('warmImageCapabilities', () => {
    let counter = 0
    function setup({
      listModels = vi.fn(async (): Promise<ImageModelInfo[]> => []),
      getModelCapabilities,
    }: {
      listModels?: (signal?: AbortSignal) => Promise<ImageModelInfo[]>
      getModelCapabilities?: (
        model: string,
        listed: ImageModelInfo[],
        signal?: AbortSignal,
      ) => Promise<ImageModelCapabilities | undefined>
    } = {}) {
      const n = counter++
      vi.mocked(createOpenRouterProvider).mockReturnValue({
        id: 'openrouter',
        name: 'openrouter',
        generate: vi.fn(async (_options: unknown) => ({ base64: 'RESULT' })),
        listModels,
        getModelCapabilities,
      })
      const profile = (model: string, over: Partial<ImageProfile> = {}) =>
        ({
          id: `warm-${n}`,
          providerType: 'openrouter',
          apiKey: `sk-warm-${n}`,
          model,
          providerOptions: {},
          ...over,
        }) as ImageProfile
      return { listModels, profile }
    }

    it('lists once for the same profile passed several times', async () => {
      const { listModels, profile } = setup({
        listModels: vi.fn(async () => [{ id: 'm', name: 'm' }]),
      })

      await warmImageCapabilities([profile('m'), profile('m'), profile('m')])

      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('lists once for two profiles on one connection', async () => {
      const { listModels, profile } = setup({
        listModels: vi.fn(async () => [
          { id: 'a', name: 'a' },
          { id: 'b', name: 'b' },
        ]),
      })

      await warmImageCapabilities([profile('a', { id: 'p1' }), profile('b', { id: 'p2' })])

      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('reads a listed model from the list, and generation does not list again', async () => {
      const getModelCapabilities = vi.fn(async (): Promise<undefined> => undefined)
      const { listModels, profile } = setup({
        listModels: vi.fn(async () => [{ id: 'm', name: 'm' }]),
        getModelCapabilities,
      })
      const warmed = profile('m')
      vi.mocked(settings.getImageProfile).mockReturnValue(warmed)

      await warmImageCapabilities([warmed])
      await generateImage({ profileId: warmed.id, model: 'm', prompt: 'x' })

      expect(getModelCapabilities).not.toHaveBeenCalled()
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('looks up a model the list omits once, and generation does not ask again', async () => {
      const getModelCapabilities = vi.fn(async () => ({ maxReferenceImages: 2 }))
      const { profile } = setup({
        listModels: vi.fn(async () => [{ id: 'other', name: 'other' }]),
        getModelCapabilities,
      })
      const warmed = profile('m')
      vi.mocked(settings.getImageProfile).mockReturnValue(warmed)

      await warmImageCapabilities([warmed])
      await generateImage({ profileId: warmed.id, model: 'm', prompt: 'x' })

      expect(getModelCapabilities).toHaveBeenCalledTimes(1)
    })

    it('resolves when the list fails, and generation lists again', async () => {
      const listModels = vi
        .fn<() => Promise<ImageModelInfo[]>>()
        .mockRejectedValueOnce(new Error('503'))
        .mockResolvedValue([{ id: 'm', name: 'm' }])
      const { profile } = setup({ listModels })
      const warmed = profile('m')
      vi.mocked(settings.getImageProfile).mockReturnValue(warmed)

      await expect(warmImageCapabilities([warmed])).resolves.toBeUndefined()
      await generateImage({ profileId: warmed.id, model: 'm', prompt: 'x' })

      expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('does not list for a provider whose capabilities are a table', async () => {
      const listModels = vi.fn(async (): Promise<ImageModelInfo[]> => [])
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))

      await warmImageCapabilities([
        {
          id: 'warm-openai',
          providerType: 'openai',
          apiKey: 'sk-warm-openai',
          model: 'gpt-image-1',
          providerOptions: {},
        } as ImageProfile,
      ])

      expect(listModels).not.toHaveBeenCalled()
    })
  })

  describe('capability source', () => {
    let counter = 0
    function setup(providerType: ImageProviderType, over: Partial<ImageProfile> = {}) {
      const n = counter++
      const generate = vi.fn(async (_options: unknown) => ({ base64: 'RESULT' }))
      const listModels = vi.fn(async (): Promise<ImageModelInfo[]> => [])
      const provider = { id: providerType, name: providerType, generate, listModels }
      vi.mocked(createOpenAIProvider).mockReturnValue(provider)
      vi.mocked(createGoogleProvider).mockReturnValue(provider)
      vi.mocked(createZhipuProvider).mockReturnValue(provider)
      vi.mocked(createComfyProvider).mockReturnValue(provider)
      vi.mocked(createA1111Provider).mockReturnValue(provider)
      vi.mocked(settings.getImageProfile).mockReturnValue({
        id: `source-${n}`,
        providerType,
        apiKey: `sk-source-${n}`,
        model: 'm',
        providerOptions: {},
        ...over,
      } as ImageProfile)
      return { generate, listModels }
    }

    const generate = () => generateImage({ profileId: 'p', model: 'm', prompt: 'x' })

    it.each([
      ['openai', openaiModelCapabilities],
      ['google', googleModelCapabilities],
    ] as const)(
      'hands a %s profile its table and does not list models',
      async (providerType, lookup) => {
        const table = { supportedResolutions: ['1024x1024'] }
        vi.mocked(lookup).mockReturnValue(table)
        const { generate: send, listModels } = setup(providerType)

        await generate()

        expect(lookup).toHaveBeenCalledWith('m')
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: table }))
        expect(listModels).not.toHaveBeenCalled()
      },
    )

    it('reads the table in supportsReferenceImages', async () => {
      vi.mocked(openaiModelCapabilities).mockReturnValue({ supportsImg2Img: false })
      setup('openai')

      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it.each(['zhipu', 'comfyui', 'a1111'] as const)(
      'gives a %s profile no capabilities and does not list models',
      async (providerType) => {
        const { generate: send, listModels } = setup(providerType)

        await generate()

        expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: undefined }))
        expect(listModels).not.toHaveBeenCalled()
      },
    )
  })

  describe('model listing failures', () => {
    function failingProvider() {
      vi.mocked(createOpenAIProvider).mockReturnValue(
        adapter(async () => {
          throw new Error('Image API error 401: bad key')
        }),
      )
    }

    it('rethrows from listImageModels so the profile form can show it', async () => {
      failingProvider()
      await expect(listImageModels(conn('openai', 'sk-fail-a'), true)).rejects.toThrow('bad key')
    })

    it('does not cache a failure', async () => {
      failingProvider()
      await expect(listImageModels(conn('openai', 'sk-fail-b'), false)).rejects.toThrow()

      const listModels = vi.fn(async () => [{ id: 'm', name: 'm', supportsImg2Img: true }])
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))
      expect(await listImageModels(conn('openai', 'sk-fail-b'), false)).toHaveLength(1)
      expect(listModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancelled model listing', () => {
    it('hands the signal to the adapter', async () => {
      const listModels = vi.fn(async (_signal?: AbortSignal) => [])
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))
      const { signal } = new AbortController()

      await listImageModels(conn('openai', 'sk-abort-pass'), true, signal)

      expect(listModels.mock.calls[0][0]).toBe(signal)
    })

    it('rejects and caches nothing when the abort lands as the adapter returns a list', async () => {
      const controller = new AbortController()
      const listModels = vi.fn(async (_signal?: AbortSignal) => {
        controller.abort()
        return [{ id: 'partial', name: 'partial' }]
      })
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))

      await expect(
        listImageModels(conn('openai', 'sk-abort-cache'), false, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' })

      listModels.mockImplementationOnce(async () => [{ id: 'full', name: 'full' }])
      const models = await listImageModels(conn('openai', 'sk-abort-cache'), false)
      expect(models.map((m) => m.id)).toEqual(['full'])
      expect(listModels).toHaveBeenCalledTimes(2)
    })
  })

  describe('overlapping list requests', () => {
    const deferred = () => {
      const resolvers: ((models: ImageModelInfo[]) => void)[] = []
      const listModels = vi.fn(
        () => new Promise<ImageModelInfo[]>((resolve) => resolvers.push(resolve)),
      )
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))
      return { listModels, resolvers }
    }
    const ids = (models: ImageModelInfo[]) => models.map((m) => m.id)

    it('keeps the list of the request that started last when an earlier one finishes after it', async () => {
      const { listModels, resolvers } = deferred()
      const connection = conn('openai', 'sk-order-forced')

      const warmup = listImageModels(connection, false)
      const refresh = listImageModels(connection, true)
      resolvers[1]([{ id: 'new', name: 'new' }])
      await refresh
      resolvers[0]([{ id: 'old', name: 'old' }])

      expect(ids(await warmup)).toEqual(['old'])
      expect(ids(await listImageModels(connection, false))).toEqual(['new'])
      expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('stores an earlier request that finishes first, then the later one', async () => {
      const { resolvers } = deferred()
      const connection = conn('openai', 'sk-order-natural')

      const first = listImageModels(connection, false)
      const second = listImageModels(connection, true)
      resolvers[0]([{ id: 'old', name: 'old' }])
      await first
      expect(ids(await listImageModels(connection, false))).toEqual(['old'])

      resolvers[1]([{ id: 'new', name: 'new' }])
      await second
      expect(ids(await listImageModels(connection, false))).toEqual(['new'])
    })
  })

  describe('empty model lists', () => {
    const MINUTE = 60 * 1000
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('asks a catalogue provider again after five minutes', async () => {
      const listModels = vi.fn(async (): Promise<ImageModelInfo[]> => [])
      vi.mocked(createOpenRouterProvider).mockReturnValue({
        ...adapter(listModels),
        id: 'openrouter',
      })
      const connection = conn('openrouter', 'sk-empty-catalogue')

      await listImageModels(connection, false)
      await vi.advanceTimersByTimeAsync(5 * MINUTE - 1)
      await listImageModels(connection, false)
      expect(listModels).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await listImageModels(connection, false)
      expect(listModels).toHaveBeenCalledTimes(2)
    })

    it('keeps an empty list for a host that has no route for 12 hours', async () => {
      const listModels = vi.fn(async (): Promise<ImageModelInfo[]> => [])
      vi.mocked(createOpenAICompatibleProvider).mockReturnValue({
        ...adapter(listModels),
        id: 'openai-compatible',
      })
      const connection = conn('openai-compatible', 'sk-empty-route', 'https://host.test/v1')

      await listImageModels(connection, false)
      await vi.advanceTimersByTimeAsync(60 * MINUTE)
      await listImageModels(connection, false)
      expect(listModels).toHaveBeenCalledTimes(1)
    })
  })

  describe('model cache key', () => {
    let listModels: ReturnType<typeof vi.fn<NonNullable<ImageProvider['listModels']>>>

    beforeEach(() => {
      listModels = vi.fn(async () => [{ id: 'm', name: 'm', supportsImg2Img: true }])
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))
    })

    it('shares one entry across base URLs that normalize alike', async () => {
      vi.mocked(normalizeBaseUrl)
        .mockReturnValueOnce('https://normalized.test/v1')
        .mockReturnValueOnce('https://normalized.test/v1')

      await listImageModels(conn('openai', 'sk-key-norm', 'https://one.test/'), false)
      await listImageModels(conn('openai', 'sk-key-norm', 'https://two.test//'), false)

      expect(normalizeBaseUrl).toHaveBeenCalledWith('https://one.test/')
      expect(normalizeBaseUrl).toHaveBeenCalledWith('https://two.test//')
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    describe('lifetime', () => {
      const HOUR = 60 * 60 * 1000

      beforeEach(() => {
        vi.useFakeTimers()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('serves an entry for 12 hours, then refetches', async () => {
        await listImageModels(conn('openai', 'sk-ttl-0000'), false)
        vi.advanceTimersByTime(12 * HOUR - 1)
        await listImageModels(conn('openai', 'sk-ttl-0000'), false)
        expect(listModels).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(1)
        await listImageModels(conn('openai', 'sk-ttl-0000'), false)
        expect(listModels).toHaveBeenCalledTimes(2)
      })

      it('keeps distinct API keys with a shared tail apart', async () => {
        await listImageModels(conn('openai', 'sk-aaa-shared-tail'), false)
        await listImageModels(conn('openai', 'sk-bbb-shared-tail'), false)
        expect(listModels).toHaveBeenCalledTimes(2)
      })

      it('refetches on forceReload and replaces the entry', async () => {
        await listImageModels(conn('openai', 'sk-force-0000'), false)
        await listImageModels(conn('openai', 'sk-force-0000'), true)
        await listImageModels(conn('openai', 'sk-force-0000'), false)
        expect(listModels).toHaveBeenCalledTimes(2)
      })
    })

    describe('evictReplacedModelList', () => {
      it('drops the old connection when the key changes and keeps the new one', async () => {
        await listImageModels(conn('openai', 'sk-evict-old'), false)
        await listImageModels(conn('openai', 'sk-evict-new'), false)
        listModels.mockClear()

        evictReplacedModelList(conn('openai', 'sk-evict-old'), conn('openai', 'sk-evict-new'))

        await listImageModels(conn('openai', 'sk-evict-new'), false)
        expect(listModels).not.toHaveBeenCalled()
        await listImageModels(conn('openai', 'sk-evict-old'), false)
        expect(listModels).toHaveBeenCalledTimes(1)
      })

      it('drops the old connection when the base URL changes', async () => {
        await listImageModels(conn('openai', 'sk-evict-url', 'https://one.test'), false)
        listModels.mockClear()

        evictReplacedModelList(
          conn('openai', 'sk-evict-url', 'https://one.test'),
          conn('openai', 'sk-evict-url', 'https://two.test'),
        )

        await listImageModels(conn('openai', 'sk-evict-url', 'https://one.test'), false)
        expect(listModels).toHaveBeenCalledTimes(1)
      })

      it('keeps the entry when the connection is unchanged', async () => {
        await listImageModels(conn('openai', 'sk-evict-same'), false)
        listModels.mockClear()

        evictReplacedModelList(conn('openai', 'sk-evict-same'), conn('openai', 'sk-evict-same'))

        await listImageModels(conn('openai', 'sk-evict-same'), false)
        expect(listModels).not.toHaveBeenCalled()
      })
    })
  })
})
