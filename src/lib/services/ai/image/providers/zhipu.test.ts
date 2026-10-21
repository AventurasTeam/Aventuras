import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./openaiCompatibleProvider', () => ({
  generateOpenAICompatibleImage: vi.fn(async () => ({ base64: 'RESULT' })),
}))

import { generateOpenAICompatibleImage } from './openaiCompatibleProvider'
import { createZhipuProvider } from './zhipu'
import type { ImageGenerateOptions } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'glm-image',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  ...over,
})

const lastImageCall = () => vi.mocked(generateOpenAICompatibleImage).mock.lastCall![0]

beforeEach(() => vi.clearAllMocks())

describe('Z.AI adapter', () => {
  it('generates against api.z.ai under the zhipu-image debug id', async () => {
    const result = await createZhipuProvider({ apiKey: 'k' }).generate(options())

    expect(result).toEqual({ base64: 'RESULT' })
    expect(lastImageCall()).toMatchObject({
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: 'k',
      serviceId: 'zhipu-image',
      model: 'glm-image',
      prompt: 'a castle',
    })
  })

  it.each([undefined, '', '   '])('falls back to the default host for %j', async (baseUrl) => {
    await createZhipuProvider({ apiKey: 'k', baseUrl }).generate(options())
    expect(lastImageCall().baseUrl).toBe('https://api.z.ai/api/paas/v4')
  })

  it('uses a configured base URL, trimming whitespace and trailing slashes', async () => {
    await createZhipuProvider({
      apiKey: 'k',
      baseUrl: ' https://open.bigmodel.cn/api/paas/v4// ',
    }).generate(options())
    expect(lastImageCall().baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4')
  })

  it('passes the model through without a fallback', async () => {
    await createZhipuProvider({ apiKey: 'k' }).generate(options({ model: 'cogview-4-250304' }))
    expect(lastImageCall().model).toBe('cogview-4-250304')
  })

  it('sends no reference images', async () => {
    await createZhipuProvider({ apiKey: 'k' }).generate(
      options({ referenceImages: ['iVBORw0KGgo='] }),
    )
    expect(lastImageCall()).not.toHaveProperty('referenceImages')
  })

  it('forwards the abort signal', async () => {
    const signal = new AbortController().signal
    await createZhipuProvider({ apiKey: 'k' }).generate(options({ signal }))
    expect(lastImageCall().signal).toBe(signal)
  })

  it.each([
    ['square', 'tiny', '1024x1024'],
    ['square', 'small', '1024x1024'],
    ['square', 'medium', '1536x1536'],
    ['square', 'large', '2048x2048'],
    ['landscape', 'tiny', '1824x1024'],
    ['landscape', 'small', '1824x1024'],
    ['landscape', 'medium', '1824x1024'],
    ['landscape', 'large', '2048x1152'],
    ['portrait', 'tiny', '1024x1824'],
    ['portrait', 'small', '1024x1824'],
    ['portrait', 'medium', '1024x1824'],
    ['portrait', 'large', '1152x2048'],
  ] as const)('fits %s %s to glm-image as %s', async (orientation, size, expected) => {
    await createZhipuProvider({ apiKey: 'k' }).generate(options({ spec: { orientation, size } }))
    expect(lastImageCall().size).toBe(expected)
  })

  it('lists only glm-image, without making a request', async () => {
    expect(await createZhipuProvider({ apiKey: 'k' }).listModels()).toEqual([
      { id: 'glm-image', name: 'GLM-Image', supportsImg2Img: false },
    ])
  })
})
