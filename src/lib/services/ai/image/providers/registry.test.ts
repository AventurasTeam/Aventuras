import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { createZhipuProvider } from './zhipu'
import { comfyReferenceLimit, createComfyProvider } from './comfy'
import { createA1111Provider } from './a1111'
import { createGoogleProvider, googleModelCapabilities } from './google'
import type { ImageModelInfo, ImageProvider } from './types'
import {
  supportsImageGeneration,
  requiresApiKey,
  takesApiKey,
  baseUrlMode,
  connectionFor,
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDER_OPTIONS,
  generateImage,
  supportsReferenceImages,
  listImageModels,
  listImageModelsByProvider,
} from './registry'
import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageModelCapabilities, ImageProfile, ImageProviderType } from '#lib/types/index.ts'
import { IMAGE_MODEL_SNAPSHOT_VERSION } from './modelSnapshot'

describe('Image Provider Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(comfyReferenceLimit).mockReturnValue(0)
    vi.mocked(openaiModelCapabilities).mockReturnValue(undefined)
    vi.mocked(googleModelCapabilities).mockReturnValue(undefined)
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

    it('does not mistake an inherited object key for a provider', () => {
      expect(supportsImageGeneration('constructor')).toBe(false)
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

  describe('baseUrlMode', () => {
    it('requires one for OpenAI Compatible, which has no endpoint of its own', () => {
      expect(baseUrlMode('openai-compatible')).toBe('required')
    })

    it.each(['nanogpt', 'openai', 'zhipu', 'comfyui', 'a1111'] satisfies ImageProviderType[])(
      'makes it optional for %s',
      (providerType) => {
        expect(baseUrlMode(providerType)).toBe('optional')
      },
    )

    it.each(['openrouter', 'pollinations', 'google'] satisfies ImageProviderType[])(
      'offers none for the fixed endpoint of %s',
      (providerType) => {
        expect(baseUrlMode(providerType)).toBe('none')
      },
    )

    it('offers none for an unknown provider', () => {
      expect(baseUrlMode('unknown-provider')).toBe('none')
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
      const snapshotOf = (capabilities: ImageModelCapabilities) => ({
        model: 'm',
        version: IMAGE_MODEL_SNAPSHOT_VERSION,
        capturedAt: 1,
        capabilities,
      })
      const profile = (providerType: ImageProviderType, over: Partial<ImageProfile>) =>
        ({
          providerType,
          apiKey: 'k',
          providerOptions: {},
          modelSnapshot: snapshotOf({ supportsImg2Img: true }),
          ...over,
        }) as ImageProfile

      it('turns references off over a model the list says takes them', async () => {
        vi.mocked(settings.getImageProfile).mockReturnValue(
          profile('openai-compatible', { capabilityOverride: { references: false } }),
        )
        expect(await supportsReferenceImages('p', 'm')).toBe(false)
      })

      it('turns references on over a model the list says lacks them', async () => {
        vi.mocked(settings.getImageProfile).mockReturnValue(
          profile('openai-compatible', {
            capabilityOverride: { references: true },
            modelSnapshot: snapshotOf({ supportsImg2Img: false }),
          }),
        )
        expect(await supportsReferenceImages('p', 'm')).toBe(true)
      })

      it('names the override when it leaves a model that needs a reference without one', async () => {
        vi.mocked(settings.getImageProfile).mockReturnValue(
          profile('openai-compatible', {
            model: 'm',
            capabilityOverride: { references: false },
            modelSnapshot: snapshotOf({ requiresReferenceImage: true }),
          }),
        )
        await expect(generateImage({ profileId: 'p', model: 'm', prompt: 'x' })).rejects.toThrow(
          'References override is Off',
        )
      })

      it('is ignored by a provider that takes none', async () => {
        vi.mocked(settings.getImageProfile).mockReturnValue(
          profile('openrouter', { capabilityOverride: { references: false } }),
        )
        expect(await supportsReferenceImages('p', 'm')).toBe(true)
      })
    })
  })
  describe('model snapshot', () => {
    // The failure set and the model cache outlive a test, so each case gets its own profile.
    let counter = 0
    function setup(
      over: Partial<ImageProfile> = {},
      {
        listModels = vi.fn(async (): Promise<ImageModelInfo[]> => []),
        getModelCapabilities,
      }: {
        listModels?: () => Promise<ImageModelInfo[]>
        getModelCapabilities?: (model: string) => Promise<ImageModelCapabilities | undefined>
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
        id: `snap-${n}`,
        providerType: 'openrouter',
        apiKey: `sk-snap-${n}`,
        model: 'm',
        providerOptions: {},
        ...over,
      } as ImageProfile
      vi.mocked(settings.getImageProfile).mockReturnValue(profile)
      vi.mocked(settings.updateImageProfile).mockResolvedValue(undefined)
      vi.mocked(fetchPublicImageBase64).mockResolvedValue('DOWNLOADED')
      return { profile, generate, listModels }
    }

    const snapshot = (capabilities: ImageModelCapabilities) => ({
      model: 'm',
      version: IMAGE_MODEL_SNAPSHOT_VERSION,
      capturedAt: 1,
      capabilities,
    })

    const generate = (model = 'm', referenceImages?: string[]) =>
      generateImage({ profileId: 'p', model, prompt: 'x', referenceImages })

    it('reads a current snapshot without listing models', async () => {
      const capabilities = { maxReferenceImages: 1, supportedResolutions: ['1k'] }
      const { generate: send, listModels } = setup({ modelSnapshot: snapshot(capabilities) })

      await generate('m', ['https://img.test/a.png', 'https://img.test/b.png'])

      expect(listModels).not.toHaveBeenCalled()
      expect(fetchPublicImageBase64).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: capabilities }))
    })

    it('looks a legacy profile up once and saves the result', async () => {
      const { profile, listModels } = setup(
        {},
        {
          listModels: vi.fn(async () => [
            { id: 'm', name: 'm', supportsImg2Img: true, maxReferenceImages: 2 },
          ]),
        },
      )

      await generate()

      expect(listModels).toHaveBeenCalledTimes(1)
      expect(settings.updateImageProfile).toHaveBeenCalledWith(profile.id, {
        modelSnapshot: expect.objectContaining({
          model: 'm',
          version: IMAGE_MODEL_SNAPSHOT_VERSION,
          capabilities: expect.objectContaining({ maxReferenceImages: 2 }),
        }),
      })

      const saved = vi.mocked(settings.updateImageProfile).mock.calls[0][1].modelSnapshot
      vi.mocked(settings.getImageProfile).mockReturnValue({ ...profile, modelSnapshot: saved })
      await generate()
      expect(listModels).toHaveBeenCalledTimes(1)
    })

    it('saves an empty snapshot for a model the list does not know', async () => {
      const { profile } = setup()

      await generate()

      expect(settings.updateImageProfile).toHaveBeenCalledWith(profile.id, {
        modelSnapshot: expect.objectContaining({ capabilities: {} }),
      })
    })

    it('refuses a model that edits only when no reference could be sent', async () => {
      const { generate: send } = setup({
        modelSnapshot: snapshot({ requiresReferenceImage: true }),
      })
      vi.mocked(fetchPublicImageBase64).mockRejectedValue(new Error('refused'))

      await expect(generate()).rejects.toThrow('needs a reference image')
      await expect(generate('m', ['https://img.test/a.png'])).rejects.toThrow(
        'needs a reference image',
      )
      expect(send).not.toHaveBeenCalled()
    })

    it('uses a provider’s own per-model lookup instead of its list', async () => {
      const getModelCapabilities = vi.fn(async () => ({ supportedAspectRatios: ['1:1'] }))
      const { profile, listModels } = setup({}, { getModelCapabilities })

      await generate()

      expect(getModelCapabilities).toHaveBeenCalledWith('m')
      expect(listModels).not.toHaveBeenCalled()
      expect(settings.updateImageProfile).toHaveBeenCalledWith(profile.id, {
        modelSnapshot: expect.objectContaining({
          capabilities: expect.objectContaining({ supportedAspectRatios: ['1:1'] }),
        }),
      })
    })

    it('does not fall back to the list when the per-model lookup fails', async () => {
      const getModelCapabilities = vi.fn(async (): Promise<undefined> => {
        throw new Error('503')
      })
      const { listModels, generate: send } = setup({}, { getModelCapabilities })

      await generate()

      expect(listModels).not.toHaveBeenCalled()
      expect(send).toHaveBeenCalledTimes(1)
      expect(settings.updateImageProfile).not.toHaveBeenCalled()
    })

    it('reads a snapshot in supportsReferenceImages', async () => {
      const { listModels } = setup({ modelSnapshot: snapshot({ supportsImg2Img: false }) })

      expect(await supportsReferenceImages('p', 'm')).toBe(false)
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
      vi.mocked(settings.updateImageProfile).mockResolvedValue(undefined)
      return { generate, listModels }
    }

    const staleSnapshot = {
      model: 'm',
      version: IMAGE_MODEL_SNAPSHOT_VERSION,
      capturedAt: 1,
      capabilities: { supportedResolutions: ['2k'] },
    }
    const generate = () => generateImage({ profileId: 'p', model: 'm', prompt: 'x' })

    it.each([
      ['openai', openaiModelCapabilities],
      ['google', googleModelCapabilities],
    ] as const)(
      'hands a %s profile its table, not its snapshot, and neither lists nor saves',
      async (providerType, lookup) => {
        const table = { supportedResolutions: ['1024x1024'] }
        vi.mocked(lookup).mockReturnValue(table)
        const { generate: send, listModels } = setup(providerType, {
          modelSnapshot: staleSnapshot,
        })

        await generate()

        expect(lookup).toHaveBeenCalledWith('m')
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: table }))
        expect(listModels).not.toHaveBeenCalled()
        expect(settings.updateImageProfile).not.toHaveBeenCalled()
      },
    )

    it('reads the table in supportsReferenceImages', async () => {
      vi.mocked(openaiModelCapabilities).mockReturnValue({ supportsImg2Img: false })
      setup('openai', {
        modelSnapshot: { ...staleSnapshot, capabilities: { supportsImg2Img: true } },
      })

      expect(await supportsReferenceImages('p', 'm')).toBe(false)
    })

    it.each(['zhipu', 'comfyui', 'a1111'] as const)(
      'gives a %s profile no capabilities and neither lists nor saves',
      async (providerType) => {
        const { generate: send, listModels } = setup(providerType)

        await generate()

        expect(send).toHaveBeenCalledWith(expect.objectContaining({ modelInfo: undefined }))
        expect(listModels).not.toHaveBeenCalled()
        expect(settings.updateImageProfile).not.toHaveBeenCalled()
      },
    )
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

  describe('cancelled model listing', () => {
    const adapter = (listModels: ImageProvider['listModels']): ImageProvider => ({
      id: 'openai',
      name: 'openai',
      generate: vi.fn(),
      listModels,
    })

    it('hands the signal to the adapter', async () => {
      const listModels = vi.fn(async (_apiKey?: string, _signal?: AbortSignal) => [])
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))
      const { signal } = new AbortController()

      await listImageModelsByProvider('openai', 'sk-abort-pass', true, undefined, signal)

      expect(listModels.mock.calls[0][1]).toBe(signal)
    })

    it('rejects and caches nothing when the abort lands as the adapter returns a list', async () => {
      const controller = new AbortController()
      const listModels = vi.fn(async (_apiKey?: string, _signal?: AbortSignal) => {
        controller.abort()
        return [{ id: 'partial', name: 'partial' }]
      })
      vi.mocked(createOpenAIProvider).mockReturnValue(adapter(listModels))

      await expect(
        listImageModelsByProvider('openai', 'sk-abort-cache', false, undefined, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' })

      listModels.mockImplementationOnce(async () => [{ id: 'full', name: 'full' }])
      const models = await listImageModelsByProvider('openai', 'sk-abort-cache', false)
      expect(models.map((m) => m.id)).toEqual(['full'])
      expect(listModels).toHaveBeenCalledTimes(2)
    })
  })

  describe('hidden connection fields', () => {
    it.each([
      [
        'nanogpt',
        'key',
        'https://partner.test',
        { apiKey: 'key', baseUrl: 'https://partner.test' },
      ],
      ['openrouter', 'key', 'https://stale.test', { apiKey: 'key', baseUrl: undefined }],
      ['a1111', 'stale-key', 'http://sd.test', { apiKey: '', baseUrl: 'http://sd.test' }],
      ['comfyui', 'stale-key', 'http://comfy.test', { apiKey: '', baseUrl: 'http://comfy.test' }],
      [
        'openai-compatible',
        'key',
        'https://proxy.test',
        { apiKey: 'key', baseUrl: 'https://proxy.test' },
      ],
    ] satisfies [ImageProviderType, string, string, ReturnType<typeof connectionFor>][])(
      'connectionFor(%s) keeps only the fields the provider has an input for',
      (providerType, apiKey, baseUrl, expected) => {
        expect(connectionFor(providerType, apiKey, baseUrl)).toEqual(expected)
      },
    )

    it('builds a provider without a leftover base URL', async () => {
      const listModels = vi.fn(async () => [])
      vi.mocked(createOpenRouterProvider).mockReturnValue({
        id: 'openrouter',
        name: 'openrouter',
        generate: vi.fn(),
        listModels,
      })

      await listImageModelsByProvider('openrouter', 'sk-hidden-url', true, 'https://stale.test')

      expect(createOpenRouterProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-hidden-url', baseUrl: undefined }),
      )
    })

    it('builds a provider without a leftover API key', async () => {
      const listModels = vi.fn(async () => [])
      vi.mocked(createA1111Provider).mockReturnValue({
        id: 'a1111',
        name: 'a1111',
        generate: vi.fn(),
        listModels,
      })

      await listImageModelsByProvider('a1111', 'stale-key', true, 'http://sd.test')

      expect(createA1111Provider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: '', baseUrl: 'http://sd.test' }),
      )
      expect(listModels).toHaveBeenCalledWith('', undefined)
    })
  })

  describe('model cache key', () => {
    it('shares one entry across base URLs that normalize alike', async () => {
      const listModels = vi.fn(async () => [{ id: 'm', name: 'm', supportsImg2Img: true }])
      vi.mocked(createOpenAIProvider).mockReturnValue({
        id: 'openai',
        name: 'openai',
        generate: vi.fn(),
        listModels,
      })
      vi.mocked(normalizeBaseUrl)
        .mockReturnValueOnce('https://normalized.test/v1')
        .mockReturnValueOnce('https://normalized.test/v1')

      await listImageModelsByProvider('openai', 'sk-key-norm', false, 'https://one.test/')
      await listImageModelsByProvider('openai', 'sk-key-norm', false, 'https://two.test//')

      expect(normalizeBaseUrl).toHaveBeenCalledWith('https://one.test/')
      expect(normalizeBaseUrl).toHaveBeenCalledWith('https://two.test//')
      expect(listModels).toHaveBeenCalledTimes(1)
    })
  })
})
