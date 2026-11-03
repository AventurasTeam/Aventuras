import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./openaiCompatible', () => ({
  generateOpenAICompatibleImage: vi.fn(async () => ({ base64: 'RESULT' })),
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { generateOpenAICompatibleImage } from './openaiCompatible'
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

  it.each([undefined, ''])('falls back to the default host for %j', async (baseUrl) => {
    await createZhipuProvider({ apiKey: 'k', baseUrl }).generate(options())
    expect(lastImageCall().baseUrl).toBe('https://api.z.ai/api/paas/v4')
  })

  it('uses the normalized base URL', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v4')
    await createZhipuProvider({ apiKey: 'k', baseUrl: ' https://raw.test// ' }).generate(options())
    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://raw.test// ')
    expect(lastImageCall().baseUrl).toBe('https://normalized.test/v4')
  })

  it('rejects a malformed base URL when listing models', async () => {
    await expect(createZhipuProvider({ apiKey: 'k', baseUrl: 'h' }).listModels()).rejects.toThrow(
      'Base URL is not an http(s) URL',
    )
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

  it.each([
    ['square', 'tiny', '512x512'],
    ['square', 'small', '1024x1024'],
    ['square', 'medium', '1440x1440'],
    ['square', 'large', '1440x1440'],
    ['landscape', 'tiny', '912x512'],
    ['landscape', 'small', '1024x576'],
    ['landscape', 'medium', '1536x864'],
    ['landscape', 'large', '1920x1072'],
    ['portrait', 'tiny', '512x912'],
    ['portrait', 'small', '576x1024'],
    ['portrait', 'medium', '864x1536'],
    ['portrait', 'large', '1072x1920'],
  ] as const)('fits %s %s to CogView as %s', async (orientation, size, expected) => {
    await createZhipuProvider({ apiKey: 'k' }).generate(
      options({ model: 'cogview-4-250304', spec: { orientation, size } }),
    )
    expect(lastImageCall().size).toBe(expected)
  })

  it.each(['square', 'landscape', 'portrait'] as const)(
    'keeps every %s CogView size inside the API limits',
    async (orientation) => {
      for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
        await createZhipuProvider({ apiKey: 'k' }).generate(
          options({ model: 'cogview-4', spec: { orientation, size } }),
        )
        const [width, height] = lastImageCall().size.split('x').map(Number)
        expect(Math.min(width, height)).toBeGreaterThanOrEqual(512)
        expect(Math.max(width, height)).toBeLessThanOrEqual(2048)
        expect(width % 16).toBe(0)
        expect(height % 16).toBe(0)
        expect(width * height).toBeLessThanOrEqual(2 ** 21)
      }
    },
  )

  it('sizes an unlisted cogview- id as CogView and any other id as glm-image', async () => {
    const spec = { orientation: 'square', size: 'large' } as const
    await createZhipuProvider({ apiKey: 'k' }).generate(options({ model: 'cogview-5', spec }))
    expect(lastImageCall().size).toBe('1440x1440')

    await createZhipuProvider({ apiKey: 'k' }).generate(options({ model: 'glm-image-2', spec }))
    expect(lastImageCall().size).toBe('2048x2048')
  })

  it.each(['CogView-4', ' cogview-4 '])('sizes %j as CogView', async (model) => {
    await createZhipuProvider({ apiKey: 'k' }).generate(
      options({ model, spec: { orientation: 'square', size: 'large' } }),
    )
    expect(lastImageCall().size).toBe('1440x1440')
    expect(lastImageCall().model).toBe(model)
  })

  it('lists only glm-image on api.z.ai, without making a request', async () => {
    expect(await createZhipuProvider({ apiKey: 'k' }).listModels()).toEqual([
      { id: 'glm-image', name: 'GLM-Image', supportsImg2Img: false },
    ])
  })

  it('also lists the CogView models on BigModel', async () => {
    const models = await createZhipuProvider({
      apiKey: 'k',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    }).listModels()

    expect(models.map((model) => model.id)).toEqual([
      'glm-image',
      'cogview-4-250304',
      'cogview-4',
      'cogview-3-flash',
    ])
    expect(models.every((model) => !model.supportsImg2Img)).toBe(true)
  })
})
