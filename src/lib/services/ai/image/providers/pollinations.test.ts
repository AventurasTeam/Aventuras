import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('./openaiCompatibleProvider', () => ({
  generateOpenAICompatibleImage: vi.fn(async () => ({ base64: 'RESULT' })),
}))

import { generateOpenAICompatibleImage } from './openaiCompatibleProvider'
import { createPollinationsProvider } from './pollinations'
import type { ImageGenerateOptions } from './types'

const options = (): ImageGenerateOptions => ({
  model: 'm1',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo='],
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
})
