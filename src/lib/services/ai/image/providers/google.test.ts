import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./sdkImage', () => ({
  createImageSdkFetch: vi.fn(() => 'SDK_FETCH'),
  generateSdkImage: vi.fn(async () => ({ base64: 'RESULT' })),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({ image: (id: string) => ({ id }) })),
}))
vi.mock('../../sdk/providers/fetch', () => ({
  createTimeoutFetch: vi.fn(),
}))
vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { IMAGE_SIZE_TIERS, type ImageSizeTier } from '#lib/utils/image.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { imageGetFetch } from './fetchAdapter'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import { createGoogleProvider, googleModelCapabilities } from './google'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'gemini-2.5-flash-image',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo=', '/9j/4AAQSkZJRg=='],
  ...over,
})

const sent = () => vi.mocked(generateSdkImage).mock.lastCall![0]

describe('Google adapter references', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends references to a Gemini image model', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(options())
    expect(sent()).toMatchObject({
      prompt: 'a castle',
      referenceImages: ['iVBORw0KGgo=', '/9j/4AAQSkZJRg=='],
      aspectRatio: '1:1',
    })
  })

  it('sends the plain prompt when there are no references', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(options({ referenceImages: undefined }))
    expect(sent().referenceImages).toBeUndefined()
  })
})

describe('Google size and ratio', () => {
  beforeEach(() => vi.clearAllMocks())

  const imageSizeFor = async (model: string, size: ImageSizeTier) => {
    const provider = createGoogleProvider({ apiKey: 'k' })
    await provider.generate(
      options({
        model,
        spec: { orientation: 'square', size },
        modelInfo: googleModelCapabilities(model),
      }),
    )
    return sent().providerOptions
  }
  const imageSize = (value: string) => ({ google: { imageConfig: { imageSize: value } } })

  it.each([
    ['gemini-3.1-flash-image', ['512', '1K', '2K', '2K']],
    ['gemini-nano-banana-2.1', ['1K', '1K', '2K', '2K']],
    ['gemini-3-pro-image', ['1K', '1K', '2K', '2K']],
    ['gemini-3.1-flash-lite-image', ['1K', '1K', '1K', '1K']],
  ])('%s sends the smallest listed tier that covers each size', async (model, expected) => {
    for (const [i, size] of IMAGE_SIZE_TIERS.entries()) {
      expect(await imageSizeFor(model, size)).toEqual(imageSize(expected[i]))
    }
  })

  it('sends no size to a model that lists none, or when the profile has no snapshot', async () => {
    expect(await imageSizeFor('gemini-2.5-flash-image', 'large')).toBeUndefined()

    await createGoogleProvider({ apiKey: 'k' }).generate(options({ modelInfo: undefined }))
    expect(sent().providerOptions).toBeUndefined()
  })

  it('picks the closest of the model ratios, and the fixed list without a snapshot', async () => {
    const landscape = { orientation: 'landscape', size: 'medium' } as const
    const provider = createGoogleProvider({ apiKey: 'k' })

    await provider.generate(
      options({ spec: landscape, modelInfo: { supportedAspectRatios: ['1:1', '4:3'] } }),
    )
    expect(sent().aspectRatio).toBe('4:3')

    await provider.generate(options({ spec: landscape, modelInfo: undefined }))
    expect(sent().aspectRatio).toBe('16:9')
  })
})

describe('Google transport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends SDK requests through the shared Tauri fetch', () => {
    createGoogleProvider({ apiKey: 'k' })

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: 'SDK_FETCH' }),
    )
    expect(createImageSdkFetch).toHaveBeenCalledWith('google-image')
  })
})

describe('Google model listing', () => {
  beforeEach(() => vi.clearAllMocks())

  const respond = (response: { json: () => Promise<unknown> }) =>
    vi.mocked(imageGetFetch).mockResolvedValue(response as Response)

  it('uses the normalized base URL for the SDK and the model list', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v1beta')
    respond({ json: async () => ({ models: [] }) })

    await createGoogleProvider({ apiKey: 'k', baseUrl: ' https://raw.test// ' }).listModels()

    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://raw.test// ')
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://normalized.test/v1beta' }),
    )
    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://normalized.test/v1beta/models?pageSize=200',
      { 'x-goog-api-key': 'k' },
      { serviceId: 'google-image-models', signal: undefined },
    )
  })

  it('forwards the abort signal', async () => {
    respond({ json: async () => ({ models: [] }) })
    const { signal } = new AbortController()

    await createGoogleProvider({ apiKey: 'k' }).listModels(undefined, signal)

    expect(vi.mocked(imageGetFetch).mock.calls[0][2]?.signal).toBe(signal)
  })

  it('lists from the default host without a base URL', async () => {
    respond({ json: async () => ({ models: [] }) })

    await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { 'x-goog-api-key': 'k' },
      { serviceId: 'google-image-models', signal: undefined },
    )
  })

  it('returns no models, and makes no request, without a key', async () => {
    expect(await createGoogleProvider({ apiKey: '' }).listModels()).toEqual([])
    expect(imageGetFetch).not.toHaveBeenCalled()
  })

  it('lists only the image models the SDK can generate with, each taking references', async () => {
    respond({
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash-image' },
          { name: 'models/gemini-nano-banana-2.1' },
          { name: 'models/nano-banana-pro-preview' },
          { name: 'models/gemini-3.5-flash' },
          { name: 'models/veo-3.1-generate-preview' },
        ],
      }),
    })

    const models = await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(models.map((m) => [m.id, m.supportsImg2Img, m.maxReferenceImages])).toEqual([
      ['gemini-2.5-flash-image', true, 3],
      ['gemini-nano-banana-2.1', true, 14],
    ])
  })

  it('gives a preview its generally available model’s capabilities', async () => {
    respond({
      json: async () => ({
        models: [
          { name: 'models/gemini-3-pro-image' },
          { name: 'models/gemini-3-pro-image-preview' },
        ],
      }),
    })

    const [ga, preview] = await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(preview).toMatchObject({ id: 'gemini-3-pro-image-preview' })
    expect(preview.supportedResolutions).toEqual(ga.supportedResolutions)
    expect(preview.supportedAspectRatios).toEqual(ga.supportedAspectRatios)
  })

  it('knows only that an unlisted image model takes references', async () => {
    respond({ json: async () => ({ models: [{ name: 'models/gemini-9-image' }] }) })

    const [model] = await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(model.supportedResolutions).toBeUndefined()
    expect(model.supportedAspectRatios).toBeUndefined()
    expect(model.maxReferenceImages).toBeUndefined()
    expect(model.supportsImg2Img).toBe(true)
  })

  it('returns no models when none of them generate images', async () => {
    respond({ json: async () => ({ models: [{ name: 'models/gemini-3.5-flash' }] }) })
    expect(await createGoogleProvider({ apiKey: 'k' }).listModels()).toEqual([])
  })

  it('rejects when the request fails', async () => {
    vi.mocked(imageGetFetch).mockRejectedValue(new Error('Image API error 503: unavailable'))
    await expect(createGoogleProvider({ apiKey: 'k' }).listModels()).rejects.toThrow('503')
  })
})

describe('Google model capabilities', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers from the table without a request or a key', () => {
    expect(googleModelCapabilities('gemini-3.1-flash-image')).toMatchObject({
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['512', '1K', '2K', '4K'],
    })
    expect(imageGetFetch).not.toHaveBeenCalled()
  })

  it('reads a preview as its generally available model', () => {
    expect(googleModelCapabilities('gemini-3.1-flash-image-preview')).toEqual(
      googleModelCapabilities('gemini-3.1-flash-image'),
    )
  })

  it('does not know a model the SDK cannot generate with', () => {
    expect(googleModelCapabilities('nano-banana-pro-preview')).toBeUndefined()
    expect(googleModelCapabilities('gemini-3.5-flash')).toBeUndefined()
  })
})
