import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('./openaiCompatible', () => ({
  generateOpenAICompatibleImage: vi.fn(async () => ({ base64: 'RESULT' })),
}))

import { imageGetFetch } from './fetchAdapter'
import { generateOpenAICompatibleImage } from './openaiCompatible'
import { createPollinationsProvider } from './pollinations'
import type { ImageGenerateOptions } from './types'

const options = (): ImageGenerateOptions => ({
  model: 'm1',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo='],
})

const reply = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

const catalogue = (...entries: Record<string, unknown>[]) =>
  vi.mocked(imageGetFetch).mockResolvedValue(reply(entries))

const image = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  input_modalities: ['text'],
  output_modalities: ['image'],
  ...extra,
})

describe('Pollinations adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  const lastImageCall = () => vi.mocked(generateOpenAICompatibleImage).mock.lastCall![0]

  it('generates against /v1 with the content filter off', async () => {
    await createPollinationsProvider({ apiKey: 'k' }).generate(options())
    expect(lastImageCall()).toMatchObject({
      baseUrl: 'https://gen.pollinations.ai/v1',
      apiKey: 'k',
      serviceId: 'pollinations-image',
      model: 'm1',
      prompt: 'a castle',
      size: '1536x1536',
      referenceImages: ['iVBORw0KGgo='],
      extraFields: { safe: false },
    })
  })

  it('requires an API key', async () => {
    await expect(createPollinationsProvider({ apiKey: '' }).generate(options())).rejects.toThrow(
      'API key',
    )
    expect(generateOpenAICompatibleImage).not.toHaveBeenCalled()
  })

  describe('resolution tier', () => {
    const generateWith = (supportedResolutions?: string[], size: 'small' | 'medium' = 'medium') =>
      createPollinationsProvider({ apiKey: 'k' }).generate({
        ...options(),
        spec: { orientation: 'landscape', size },
        modelInfo: { supportedResolutions },
      })

    it('sends the listed tier that covers the size, as listed', async () => {
      await generateWith(['1k', '2k'])
      expect(lastImageCall().extraFields).toEqual({ safe: false, resolution: '2k' })

      await generateWith(['1k', '2k'], 'small')
      expect(lastImageCall().extraFields).toEqual({ safe: false, resolution: '1k' })
    })

    it.each([[undefined], [[]], [['auto']]])(
      'sends none when the model lists none (%j)',
      async (listed) => {
        await generateWith(listed)
        expect(lastImageCall().extraFields).toEqual({ safe: false })
      },
    )

    it('still sends the pixel size beside the tier', async () => {
      await generateWith(['1k', '2k'])
      expect(lastImageCall().size).toBe('1536x864')
    })
  })

  describe('listModels', () => {
    const list = (apiKey?: string, configKey = 'k') =>
      createPollinationsProvider({ apiKey: configKey }).listModels(apiKey)

    it('lists image models and skips the rest', async () => {
      catalogue(
        image('black-forest-labs/flux.1-schnell'),
        { name: 'google/veo-3.1-fast', output_modalities: ['video', 'audio'] },
        { name: 'no-modalities' },
        { title: 'no name', output_modalities: ['image'] },
      )
      expect((await list()).map((m) => m.id)).toEqual(['black-forest-labs/flux.1-schnell'])
    })

    it('labels a model by its title, falling back to its name', async () => {
      catalogue(image('a/titled', { title: 'Titled' }), image('a/untitled'))
      expect((await list()).map((m) => m.name)).toEqual(['Titled', 'a/untitled'])
    })

    it('labels a community model with its provider', async () => {
      catalogue(
        image('bytedance/seedream-5.0-lite', { title: 'Seedream 5.0 Lite' }),
        image('community/Saauf/seedream-5.0-lite', { title: 'Seedream 5.0 Lite', community: true }),
        image('community/untitled', { community: true }),
        image('community', { title: 'Bare', community: true }),
      )
      expect((await list()).map((m) => m.name)).toEqual([
        'Seedream 5.0 Lite',
        'Seedream 5.0 Lite (Community - Saauf)',
        'community/untitled (Community - untitled)',
        'Bare',
      ])
    })

    it('carries the aliases, when there are any', async () => {
      catalogue(image('a/with', { aliases: ['w', 'with'] }), image('a/without', { aliases: [] }))
      const [withAliases, without] = await list()
      expect(withAliases.aliases).toEqual(['w', 'with'])
      expect(without.aliases).toBeUndefined()
    })

    it('reads the reference limit and resolution tiers', async () => {
      catalogue(
        image('a/tiers', {
          input_modalities: ['text', 'image'],
          max_reference_images: 10,
          resolutions: ['1k', '2k'],
        }),
      )
      expect((await list())[0]).toMatchObject({
        supportsImg2Img: true,
        maxReferenceImages: 10,
        supportedResolutions: ['1k', '2k'],
      })
    })

    it('reads whether a model takes references', async () => {
      catalogue(
        image('a/limit', { input_modalities: ['text'], max_reference_images: 2 }),
        image('a/images', { input_modalities: ['text', 'image'] }),
        image('a/text', { input_modalities: ['text'] }),
        { name: 'a/unread', output_modalities: ['image'], input_modalities: 'text' },
      )
      const [limit, images, text, unread] = await list()
      expect(limit.supportsImg2Img).toBe(true)
      expect(images.supportsImg2Img).toBe(true)
      expect(images.maxReferenceImages).toBeUndefined()
      expect(text.supportsImg2Img).toBe(false)
      expect(unread.supportsImg2Img).toBeUndefined()
    })

    it('leaves out a limit and tiers it was not given', async () => {
      catalogue(image('a/none', { max_reference_images: 0, resolutions: [] }))
      const [model] = await list()
      expect(model.maxReferenceImages).toBeUndefined()
      expect(model.supportedResolutions).toBeUndefined()
      expect(model.supportedAspectRatios).toBeUndefined()
    })

    it('marks only a model that takes images and no text as needing a reference', async () => {
      catalogue(
        image('a/edit-only', { input_modalities: ['image'] }),
        image('a/both', { input_modalities: ['text', 'image'] }),
      )
      const [editOnly, both] = await list()
      expect(editOnly.requiresReferenceImage).toBe(true)
      expect(both.requiresReferenceImage).toBeUndefined()
    })

    it('sets no price', async () => {
      catalogue(
        image('a/priced', {
          pricing: { currency: 'pollen', completionImageTokens: '0.004', promptTextTokens: '1' },
        }),
      )
      const [model] = await list()
      expect(model).not.toHaveProperty('costPerImage')
      expect(model).not.toHaveProperty('costPerTextToken')
      expect(model).not.toHaveProperty('costPerImageToken')
    })

    it('sends the key when there is one', async () => {
      catalogue(image('a/m'))
      await list('arg-key')
      expect(imageGetFetch).toHaveBeenLastCalledWith(
        'https://gen.pollinations.ai/image/models',
        { Accept: 'application/json', Authorization: 'Bearer arg-key' },
        expect.objectContaining({ serviceId: 'pollinations-image-models' }),
      )

      await list(undefined, 'config-key')
      expect(vi.mocked(imageGetFetch).mock.lastCall![1]).toMatchObject({
        Authorization: 'Bearer config-key',
      })

      await list(undefined, '')
      expect(vi.mocked(imageGetFetch).mock.lastCall![1]).toEqual({ Accept: 'application/json' })
    })
  })

  describe('getModelCapabilities', () => {
    const lookup = (model: string) =>
      createPollinationsProvider({ apiKey: 'k' }).getModelCapabilities!(model)

    beforeEach(() =>
      catalogue(
        image('black-forest-labs/flux.1-schnell', { aliases: ['flux'], max_reference_images: 3 }),
        { name: 'google/veo-3.1-fast', aliases: ['veo'], output_modalities: ['video'] },
      ),
    )

    it('finds a model by its id and by an alias', async () => {
      expect(await lookup('black-forest-labs/flux.1-schnell')).toMatchObject({
        maxReferenceImages: 3,
      })
      expect(await lookup('flux')).toMatchObject({ maxReferenceImages: 3 })
    })

    it('prefers an exact id over another model’s alias', async () => {
      catalogue(
        image('a/first', { aliases: ['flux'], max_reference_images: 1 }),
        image('flux', { max_reference_images: 5 }),
      )
      expect(await lookup('flux')).toMatchObject({ maxReferenceImages: 5 })
    })

    it('does not resolve a video model', async () => {
      expect(await lookup('veo')).toBeUndefined()
    })

    it('answers undefined for a model the list lacks', async () => {
      expect(await lookup('nope')).toBeUndefined()
    })

    it('rejects when the reply holds no image models', async () => {
      vi.mocked(imageGetFetch).mockResolvedValue(reply({ error: 'nope' }))
      await expect(lookup('flux')).rejects.toThrow('no image models')

      catalogue()
      await expect(lookup('flux')).rejects.toThrow('no image models')
    })
  })
})
