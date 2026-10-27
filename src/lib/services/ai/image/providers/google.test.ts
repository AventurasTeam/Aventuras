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

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { createTimeoutFetch } from '../../sdk/providers/fetch'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import { createGoogleProvider } from './google'
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

  const respond = (response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) =>
    vi
      .mocked(createTimeoutFetch)
      .mockReturnValue((async () => response) as unknown as ReturnType<typeof createTimeoutFetch>)

  it('uses the normalized base URL for the SDK and the model list', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v1beta')
    const fetchFn = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ models: [] }),
    }))
    vi.mocked(createTimeoutFetch).mockReturnValue(
      fetchFn as unknown as ReturnType<typeof createTimeoutFetch>,
    )

    await createGoogleProvider({ apiKey: 'k', baseUrl: ' https://raw.test// ' }).listModels()

    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://raw.test// ')
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://normalized.test/v1beta' }),
    )
    expect(fetchFn).toHaveBeenCalledWith('https://normalized.test/v1beta/models?key=k&pageSize=200')
  })

  it('lists from the default host without a base URL', async () => {
    const fetchFn = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ models: [] }),
    }))
    vi.mocked(createTimeoutFetch).mockReturnValue(
      fetchFn as unknown as ReturnType<typeof createTimeoutFetch>,
    )

    await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(fetchFn).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=k&pageSize=200',
    )
  })

  it('returns no models, and makes no request, without a key', async () => {
    expect(await createGoogleProvider({ apiKey: '' }).listModels()).toEqual([])
    expect(createTimeoutFetch).not.toHaveBeenCalled()
  })

  it('lists only the image models the SDK can generate with, each taking references', async () => {
    respond({
      ok: true,
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

  it('returns no models when none of them generate images', async () => {
    respond({ ok: true, json: async () => ({ models: [{ name: 'models/gemini-3.5-flash' }] }) })
    expect(await createGoogleProvider({ apiKey: 'k' }).listModels()).toEqual([])
  })

  it('rejects when the request fails', async () => {
    respond({ ok: false, status: 503 })
    await expect(createGoogleProvider({ apiKey: 'k' }).listModels()).rejects.toThrow('HTTP 503')
  })
})
  it('gives a preview its generally available model’s capabilities', async () => {
    respond({
      ok: true,
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
    respond({ ok: true, json: async () => ({ models: [{ name: 'models/gemini-9-image' }] }) })

    const [model] = await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(model.supportedResolutions).toBeUndefined()
    expect(model.supportedAspectRatios).toBeUndefined()
    expect(model.maxReferenceImages).toBeUndefined()
    expect(model.supportsImg2Img).toBe(true)
  })


describe('Google model capabilities', () => {
  beforeEach(() => vi.clearAllMocks())

  const capabilities = (model: string) =>
    createGoogleProvider({ apiKey: '' }).getModelCapabilities!(model)

  it('answers from the table without a request or a key', async () => {
    expect(await capabilities('gemini-3.1-flash-image')).toMatchObject({
      supportsImg2Img: true,
      maxReferenceImages: 14,
      supportedResolutions: ['512', '1K', '2K', '4K'],
    })
    expect(createTimeoutFetch).not.toHaveBeenCalled()
  })

  it('reads a preview as its generally available model', async () => {
    expect(await capabilities('gemini-3.1-flash-image-preview')).toEqual(
      await capabilities('gemini-3.1-flash-image'),
    )
  })

  it('does not know a model the SDK cannot generate with', async () => {
    expect(await capabilities('nano-banana-pro-preview')).toBeUndefined()
    expect(await capabilities('gemini-3.5-flash')).toBeUndefined()
  })
})
