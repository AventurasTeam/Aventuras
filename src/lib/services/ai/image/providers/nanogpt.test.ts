import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

const sdkFetch = vi.hoisted(() => vi.fn())
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => sdkFetch),
}))

import { imageGetFetch } from './fetchAdapter'
import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { createNanoGPTProvider } from './nanogpt'
import type { ImageGenerateOptions, ImageModelInfo } from './types'

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'm1',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  referenceImages: ['iVBORw0KGgo='],
  ...over,
})

const modelsResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response

const modelInfo = (over: Partial<ImageModelInfo> = {}): ImageModelInfo => ({
  id: 'm1',
  name: 'm1',
  supportsImg2Img: true,
  ...over,
})

function sentRequest() {
  const [url, init] = sdkFetch.mock.calls[0] as [string, RequestInit]
  return {
    url,
    headers: new Headers(init.headers),
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

describe('NanoGPT adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdkFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'RESULT' }] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    )
  })

  it('posts to /images on the api.nano-gpt.com host and returns the image', async () => {
    const result = await createNanoGPTProvider({ apiKey: 'k' }).generate(options())
    const { url, headers, body } = sentRequest()
    expect(url).toBe('https://api.nano-gpt.com/api/v1/images')
    expect(headers.get('Authorization')).toBe('Bearer k')
    expect(body).toMatchObject({ model: 'm1', prompt: 'a castle', n: 1 })
    expect(result).toEqual({ base64: 'RESULT' })
  })

  it('labels its fetch nanogpt-image', () => {
    createNanoGPTProvider({ apiKey: 'k' })
    expect(createSdkFetch).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'nanogpt-image' }),
    )
  })

  it.each(['https://nano-gpt.com/api/v1', 'https://nano-gpt.com/api/v1/', 'https://proxy.test/v1'])(
    'keeps the configured base URL %s',
    async (baseUrl) => {
      await createNanoGPTProvider({ apiKey: 'k', baseUrl }).generate(options())
      expect(sentRequest().url).toBe(`${baseUrl.replace(/\/+$/, '')}/images`)
    },
  )

  it("picks the resolution from the model's supported resolutions", async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(
      options({ modelInfo: modelInfo({ supportedResolutions: ['square_hd', 'landscape_16_9'] }) }),
    )
    expect(sentRequest().body.resolution).toBe('square_hd')
  })

  it('sends canonical pixels when the model lists no resolutions', async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(options())
    expect(sentRequest().body.resolution).toBe('1536x1536')
  })

  it('sends the closest listed aspect ratio', async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(
      options({
        spec: { orientation: 'landscape', size: 'medium' },
        modelInfo: modelInfo({
          supportedResolutions: ['1k', '2k'],
          supportedAspectRatios: ['1:1', '16:9'],
        }),
      }),
    )
    expect(sentRequest().body).toMatchObject({ resolution: '1k', aspect_ratio: '16:9' })
  })

  it('sends no aspect ratio when the model lists none', async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(
      options({ spec: { orientation: 'landscape', size: 'medium' } }),
    )
    expect(sentRequest().body).not.toHaveProperty('aspect_ratio')
  })

  it('sends references as data URLs', async () => {
    await createNanoGPTProvider({ apiKey: 'k' }).generate(options())
    expect(sentRequest().body.input_references).toEqual(['data:image/png;base64,iVBORw0KGgo='])
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

  it('reads the aspect ratios a model lists and drops the options that are not ratios', async () => {
    const aspect = (...values: string[]) => ({
      additionalParams: { aspect_ratio: { options: values.map((value) => ({ value })) } },
    })
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        models: {
          image: {
            a: { name: 'a', model: 'a', ...aspect('auto', '1:1', '16:9', 'match_input_image', '') },
            b: { name: 'b', model: 'b', ...aspect('auto') },
            c: { name: 'c', model: 'c' },
          },
        },
      }),
    )
    const models = await createNanoGPTProvider({ apiKey: 'k' }).listModels()
    expect(models.map((m) => [m.id, m.supportedAspectRatios])).toEqual([
      ['a', ['1:1', '16:9']],
      ['b', undefined],
      ['c', undefined],
    ])
  })
})
