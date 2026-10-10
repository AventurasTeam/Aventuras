import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  generateImage: vi.fn(async () => ({ images: [{ base64: 'RESULT' }] })),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({ image: (id: string) => ({ id }) })),
}))
vi.mock('../../sdk/providers/modelFetcher', () => ({
  isGoogleImageModel: (id: string) => id.includes('-image'),
}))
vi.mock('../../sdk/providers/fetch', () => ({
  createTimeoutFetch: vi.fn(),
}))

import { generateImage } from 'ai'
import { createTimeoutFetch } from '../../sdk/providers/fetch'
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

  it('leaves an Imagen model on the plain prompt, which the SDK would reject with images', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(
      options({ model: 'imagen-4.0-generate-001' }),
    )
    expect(sentPrompt()).toBe('a castle')
  })

  it('sends the plain prompt when there are no references', async () => {
    await createGoogleProvider({ apiKey: 'k' }).generate(options({ referenceImages: undefined }))
    expect(sentPrompt()).toBe('a castle')
  })
})

describe('Google model reference support', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the fallback Imagen models as taking no references', async () => {
    const models = await createGoogleProvider({ apiKey: '' }).listModels()
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.supportsImg2Img).toBe(false)
      expect(model.maxReferenceImages).toBe(0)
    }
  })

  it('marks gemini-* models as taking references and Imagen models as taking none', async () => {
    vi.mocked(createTimeoutFetch).mockReturnValue((async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash-image' },
          { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
        ],
      }),
    })) as unknown as ReturnType<typeof createTimeoutFetch>)

    const models = await createGoogleProvider({ apiKey: 'k' }).listModels()

    expect(models.map((m) => [m.id, m.supportsImg2Img, m.maxReferenceImages])).toEqual([
      ['gemini-2.5-flash-image', true, undefined],
      ['imagen-4.0-generate-001', false, 0],
    ])
  })
})
