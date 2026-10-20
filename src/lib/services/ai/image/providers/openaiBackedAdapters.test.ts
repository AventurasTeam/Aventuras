import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  imageGetFetch: vi.fn(),
}))
vi.mock('./openaiCompatible', () => ({
  generateOpenAICompatible: vi.fn(async () => ({ base64: 'RESULT' })),
}))

import { imageGetFetch } from './fetchAdapter'
import { generateOpenAICompatible } from './openaiCompatible'
import { createNanoGPTProvider } from './nanogpt'
import { createPollinationsProvider } from './pollinations'
import { POLLINATIONS_DEFAULT_MODEL_ID } from '../constants'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'm1',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo='],
  ...over,
})

const lastCall = () => vi.mocked(generateOpenAICompatible).mock.lastCall![0]

const modelsResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response

describe('NanoGPT adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to the api.nano-gpt.com host', async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(options())
    expect(lastCall().baseUrl).toBe('https://api.nano-gpt.com/api/v1')
    expect(lastCall().serviceId).toBe('nanogpt-image')
  })

  it.each(['https://nano-gpt.com/api/v1', 'https://nano-gpt.com/api/v1/'])(
    'treats the legacy host %s as unset',
    async (baseUrl) => {
      await createNanoGPTProvider({ apiKey: 'k', baseUrl }).generate(options())
      expect(lastCall().baseUrl).toBe('https://api.nano-gpt.com/api/v1')
    },
  )

  it('keeps a custom base URL', async () => {
    await createNanoGPTProvider({ apiKey: 'k', baseUrl: 'https://proxy.test/v1' }).generate(
      options(),
    )
    expect(lastCall().baseUrl).toBe('https://proxy.test/v1')
  })

  it("picks the size from the model's supported resolutions", async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(
      options({
        modelInfo: {
          id: 'm1',
          name: 'm1',
          supportsImg2Img: true,
          supportedResolutions: ['square_hd', 'landscape_16_9'],
        },
      }),
    )
    expect(lastCall().size).toBe('square_hd')
  })
})

describe('Pollinations adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls /v1 with the content filter off', async () => {
    await createPollinationsProvider({ apiKey: 'k' }).generate(options())
    expect(lastCall().baseUrl).toBe('https://gen.pollinations.ai/v1')
    expect(lastCall().extraFields).toEqual({ safe: false, nologo: true })
    expect(lastCall().size).toBe('1536x1536')
  })

  it('falls back to the default model', async () => {
    await createPollinationsProvider({ apiKey: 'k' }).generate(options({ model: '' }))
    expect(lastCall().model).toBe(POLLINATIONS_DEFAULT_MODEL_ID)
  })

  it('requires an API key', async () => {
    await expect(createPollinationsProvider({ apiKey: '' }).generate(options())).rejects.toThrow(
      'API key',
    )
    expect(generateOpenAICompatible).not.toHaveBeenCalled()
  })
})

describe('NanoGPT model catalogue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('limits img2img models without multi-image support to one reference', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        models: {
          image: {
            a: { name: 'a', model: 'a', tags: ['image-to-image'] },
            b: { name: 'b', model: 'b', tags: ['image-to-image'], supportsMultipleImg2Img: true },
            c: { name: 'c', model: 'c' },
          },
        },
      }),
    )
    const models = await createNanoGPTProvider({ apiKey: 'k' }).listModels()
    expect(models.map((m) => [m.id, m.maxReferenceImages])).toEqual([
      ['a', 1],
      ['b', undefined],
      ['c', undefined],
    ])
  })
})
