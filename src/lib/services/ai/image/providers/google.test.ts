import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  generateImage: vi.fn(async () => ({ images: [{ base64: 'RESULT' }] })),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({ image: (id: string) => ({ id }) })),
}))
vi.mock('../../sdk/providers/fetch', () => ({
  createTimeoutFetch: vi.fn(),
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => 'SDK_FETCH'),
}))
// The real store is a rune module, which this suite cannot import.
vi.mock('#lib/stores/debug.svelte.ts', () => ({ debug: {} }))

import { generateImage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createTimeoutFetch } from '../../sdk/providers/fetch'
import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { createGoogleProvider } from './google'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'gemini-2.5-flash-image',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo=', '/9j/4AAQSkZJRg=='],
  ...over,
})

const sentPrompt = () => vi.mocked(generateImage).mock.lastCall![0].prompt

describe('Google adapter references', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends references to a Gemini image model', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(options())
    expect(sentPrompt()).toEqual({
      text: 'a castle',
      images: ['iVBORw0KGgo=', '/9j/4AAQSkZJRg=='],
    })
  })

  it('sends the plain prompt when there are no references', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(options({ referenceImages: undefined }))
    expect(sentPrompt()).toBe('a castle')
  })
})

describe('Google transport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends SDK requests through the shared Tauri fetch', () => {
    createGoogleProvider({ apiKey: 'k' })

    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: 'SDK_FETCH' }),
    )
    expect(createSdkFetch).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'google-image', what: 'Image generation' }),
    )
  })
})

describe('Google model listing', () => {
  beforeEach(() => vi.clearAllMocks())

  const respond = (response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) =>
    vi
      .mocked(createTimeoutFetch)
      .mockReturnValue((async () => response) as unknown as ReturnType<typeof createTimeoutFetch>)

  it('returns no models, and makes no request, without a key', async () => {
    expect(await createGoogleProvider({ apiKey: '' }).listModels()).toEqual([])
    expect(createTimeoutFetch).not.toHaveBeenCalled()
  })

  it('lists only the image models, each taking references', async () => {
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
      ['gemini-2.5-flash-image', true, undefined],
      ['gemini-nano-banana-2.1', true, undefined],
      ['nano-banana-pro-preview', true, undefined],
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
