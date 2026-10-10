import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageFetch: vi.fn(),
  imageGetFetch: vi.fn(),
}))
vi.mock('./openaiCompatible', () => ({
  generateOpenAICompatible: vi.fn(async () => ({ base64: 'RESULT' })),
}))

import { generateOpenAICompatible } from './openaiCompatible'
import { createNanoGPTProvider } from './nanogpt'
import { createPollinationsProvider } from './pollinations'
import { createOpenAIProvider } from './openai'
import { POLLINATIONS_DEFAULT_MODEL_ID } from '../constants'
import { formatImageSize, specToPixels } from '$lib/utils/image'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'm1',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo='],
  ...over,
})

const lastCall = () => vi.mocked(generateOpenAICompatible).mock.calls[0][0]

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
    expect(lastCall().extraFields).toEqual({ safe: false })
    expect(lastCall().size).toBe(formatImageSize(specToPixels(options().spec)))
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

describe('OpenAI adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('limits dall-e models to one reference', async () => {
    await createOpenAIProvider({ apiKey: 'k' }).generate(options({ model: 'dall-e-2' }))
    expect(lastCall().maxReferences).toBe(1)
  })

  it('passes every reference for other models', async () => {
    await createOpenAIProvider({ apiKey: 'k' }).generate(options({ model: 'gpt-image-1' }))
    expect(lastCall().maxReferences).toBeUndefined()
    expect(lastCall().baseUrl).toBe('https://api.openai.com/v1')
  })
})
