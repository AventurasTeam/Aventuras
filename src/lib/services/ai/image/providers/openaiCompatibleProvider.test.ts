import { describe, it, expect, vi, beforeEach } from 'vitest'

const sdk = vi.hoisted(() => ({
  config: [] as Record<string, unknown>[],
}))

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn((config: Record<string, unknown>) => {
    sdk.config.push(config)
    return { imageModel: (id: string) => ({ id }) }
  }),
}))
vi.mock('./sdkImage', () => ({
  createImageSdkFetch: vi.fn((serviceId: string) => `fetch:${serviceId}`),
  generateSdkImage: vi.fn(async () => ({ base64: 'AAA' })),
}))
vi.mock('./fetchAdapter', () => ({ imageGetFetch: vi.fn() }))

import { imageGetFetch } from './fetchAdapter'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import {
  createOpenAICompatibleProvider,
  generateOpenAICompatibleImage,
} from './openaiCompatibleProvider'
import type { ImageGenerateOptions } from './types'

const BASE_URL = 'https://proxy.test/v1'
const PNG = 'iVBORw0KGgo='

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'flux-dev',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  ...over,
})

const lastGenerate = () => vi.mocked(generateSdkImage).mock.lastCall![0]

beforeEach(() => {
  sdk.config.length = 0
  vi.clearAllMocks()
})

describe('generateOpenAICompatibleImage', () => {
  const generate = (over: Partial<Parameters<typeof generateOpenAICompatibleImage>[0]> = {}) =>
    generateOpenAICompatibleImage({
      baseUrl: BASE_URL,
      apiKey: 'k',
      serviceId: 'svc-image',
      model: 'flux-dev',
      prompt: 'a castle',
      size: '1536x1536',
      ...over,
    })

  it('builds the SDK provider from the base URL, key and a fetch for the service id', async () => {
    await generate()
    expect(sdk.config).toEqual([
      { name: 'openaiCompatible', baseURL: BASE_URL, apiKey: 'k', fetch: 'fetch:svc-image' },
    ])
    expect(createImageSdkFetch).toHaveBeenCalledWith('svc-image')
  })

  it('passes no key when it is blank', async () => {
    await generate({ apiKey: '' })
    expect(sdk.config[0].apiKey).toBeUndefined()
  })

  it('hands the model, prompt, size and signal to the SDK and returns its result', async () => {
    const signal = new AbortController().signal
    const result = await generate({ signal })

    expect(result).toEqual({ base64: 'AAA' })
    expect(lastGenerate()).toMatchObject({
      model: { id: 'flux-dev' },
      prompt: 'a castle',
      size: '1536x1536',
      signal,
    })
  })

  it('forwards the reference images', async () => {
    await generate({ referenceImages: [PNG] })
    expect(lastGenerate().referenceImages).toEqual([PNG])
  })

  it('asks for b64_json and merges the extra fields', async () => {
    await generate()
    expect(lastGenerate().providerOptions).toEqual({
      openaiCompatible: { response_format: 'b64_json' },
    })

    await generate({ extraFields: { safe: false } })
    expect(lastGenerate().providerOptions).toEqual({
      openaiCompatible: { response_format: 'b64_json', safe: false },
    })
  })
})

describe('OpenAI Compatible image generation', () => {
  it('generates against the base URL under the openai-compatible-image debug id', async () => {
    const result = await createOpenAICompatibleProvider({
      apiKey: 'k',
      baseUrl: BASE_URL,
    }).generate(options({ referenceImages: [PNG] }))

    expect(result).toEqual({ base64: 'AAA' })
    expect(sdk.config[0]).toMatchObject({ baseURL: BASE_URL, apiKey: 'k' })
    expect(createImageSdkFetch).toHaveBeenCalledWith('openai-compatible-image')
    expect(lastGenerate()).toMatchObject({
      model: { id: 'flux-dev' },
      prompt: 'a castle',
      size: '1536x1536',
      referenceImages: [PNG],
    })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    await createOpenAICompatibleProvider({ apiKey: '', baseUrl: `${BASE_URL}/` }).generate(
      options(),
    )
    expect(sdk.config[0].baseURL).toBe(BASE_URL)
  })

  it.each([undefined, '', '   '])('throws without a base URL (%j)', async (baseUrl) => {
    await expect(
      createOpenAICompatibleProvider({ apiKey: 'k', baseUrl }).generate(options()),
    ).rejects.toThrow('requires a custom base URL')
    expect(generateSdkImage).not.toHaveBeenCalled()
    expect(sdk.config).toHaveLength(0)
  })
})

describe('OpenAI Compatible model listing', () => {
  const modelsResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response

  it('lists every model, unfiltered, without img2img', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [{ id: 'flux-dev' }, { id: 'gpt-4o', name: 'GPT-4o' }] }),
    )
    const models = await createOpenAICompatibleProvider({
      apiKey: 'k',
      baseUrl: BASE_URL,
    }).listModels('k')

    expect(models).toEqual([
      { id: 'flux-dev', name: 'flux-dev', supportsImg2Img: true },
      { id: 'gpt-4o', name: 'GPT-4o', supportsImg2Img: true },
    ])
    expect(imageGetFetch).toHaveBeenCalledWith(
      `${BASE_URL}/models`,
      { Authorization: 'Bearer k' },
      expect.anything(),
    )
  })

  it('accepts a bare array', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(modelsResponse([{ id: 'flux-dev' }]))
    const models = await createOpenAICompatibleProvider({
      apiKey: '',
      baseUrl: BASE_URL,
    }).listModels('')
    expect(models.map((m) => m.id)).toEqual(['flux-dev'])
    expect(vi.mocked(imageGetFetch).mock.lastCall![1]).toBeUndefined()
  })

  it('skips entries that are not objects or carry no string id or name', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        data: [null, 'flux', { id: 7 }, { name: 'only-name' }, { id: 'flux-dev', name: 3 }],
      }),
    )
    const models = await createOpenAICompatibleProvider({
      apiKey: '',
      baseUrl: BASE_URL,
    }).listModels('')

    expect(models).toEqual([
      { id: 'only-name', name: 'only-name', supportsImg2Img: true },
      { id: 'flux-dev', name: 'flux-dev', supportsImg2Img: true },
    ])
  })

  it('returns an empty list, and makes no request, without a base URL', async () => {
    expect(await createOpenAICompatibleProvider({ apiKey: 'k' }).listModels('k')).toEqual([])
    expect(imageGetFetch).not.toHaveBeenCalled()
  })

  it('rejects when the request fails', async () => {
    vi.mocked(imageGetFetch).mockRejectedValue(new Error('Image API error 502: bad gateway'))
    await expect(
      createOpenAICompatibleProvider({ apiKey: 'k', baseUrl: BASE_URL }).listModels('k'),
    ).rejects.toThrow('bad gateway')
  })

  it('returns an empty list when the proxy lists nothing', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(modelsResponse({ data: [] }))
    expect(
      await createOpenAICompatibleProvider({ apiKey: 'k', baseUrl: BASE_URL }).listModels('k'),
    ).toEqual([])
  })
})
