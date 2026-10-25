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

import { createImageSdkFetch, generateSdkImage } from './sdkImage'
import { generateOpenAICompatibleImage } from './openaiCompatible'

const BASE_URL = 'https://proxy.test/v1'
const PNG = 'iVBORw0KGgo='

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
