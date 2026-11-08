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
import { generateSdkImage } from './sdkImage'
import { createOpenAICompatibleProvider } from './openaiCompatibleProvider'
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

describe('OpenAI Compatible image generation', () => {
  it('generates against the base URL', async () => {
    const result = await createOpenAICompatibleProvider({
      apiKey: 'k',
      baseUrl: BASE_URL,
    }).generate(options({ referenceImages: [PNG] }))

    expect(result).toEqual({ base64: 'AAA' })
    expect(sdk.config[0]).toMatchObject({ baseURL: BASE_URL, apiKey: 'k' })
    expect(lastGenerate()).toMatchObject({
      model: { id: 'flux-dev' },
      prompt: 'a castle',
      size: '1536x1536',
      referenceImages: [PNG],
    })
  })

  it('sends the picked size from the snapshot, and canonical pixels without one', async () => {
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', baseUrl: BASE_URL })
    const spec = { orientation: 'landscape', size: 'medium' } as const

    await provider.generate(
      options({
        spec,
        modelInfo: { supportedResolutions: ['1024x1024', '1536x1024', '1024x1536'] },
      }),
    )
    expect(lastGenerate().size).toBe('1536x1024')

    await provider.generate(options({ spec }))
    expect(lastGenerate().size).toBe('1536x864')
  })

  it.each([undefined, ''])('throws without a base URL (%j)', async (baseUrl) => {
    await expect(
      createOpenAICompatibleProvider({ apiKey: 'k', baseUrl }).generate(options()),
    ).rejects.toThrow('requires a custom base URL')
    expect(generateSdkImage).not.toHaveBeenCalled()
    expect(sdk.config).toHaveLength(0)
  })
})

describe('OpenAI Compatible model listing', () => {
  const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
  const notJson = {
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token <')
    },
  } as unknown as Response
  const missing = { ok: false, status: 404, body: { cancel: vi.fn() } } as unknown as Response
  const failure = new Error('Image API error 502: bad gateway')

  /** Answers `/models` and `/images/models` separately; a host with no dedicated list says 404. */
  const mockHost = (replies: { models: Response | Error; images?: Response | Error }) => {
    vi.mocked(imageGetFetch).mockImplementation(async (url) => {
      const reply = url.endsWith('/images/models') ? (replies.images ?? missing) : replies.models
      if (reply instanceof Error) throw reply
      return reply
    })
  }

  const list = (apiKey = 'k') =>
    createOpenAICompatibleProvider({ apiKey, baseUrl: BASE_URL }).listModels()

  it('forwards the abort signal to both list requests', async () => {
    mockHost({ models: json({ data: [] }) })
    const { signal } = new AbortController()

    await createOpenAICompatibleProvider({ apiKey: 'k', baseUrl: BASE_URL }).listModels(signal)

    const calls = vi.mocked(imageGetFetch).mock.calls
    expect(calls).toHaveLength(2)
    for (const [, , options] of calls) expect(options?.signal).toBe(signal)
  })

  it('lists the general list and the dedicated list', async () => {
    mockHost({ models: json({ data: [] }) })
    await list('')

    expect(
      vi
        .mocked(imageGetFetch)
        .mock.calls.map(([url]) => url)
        .toSorted(),
    ).toEqual([`${BASE_URL}/images/models`, `${BASE_URL}/models`])
  })

  it('sends the key to both lists, and no header without one', async () => {
    mockHost({ models: json([]) })
    await list('k')
    for (const [, headers] of vi.mocked(imageGetFetch).mock.calls) {
      expect(headers).toEqual({ Authorization: 'Bearer k' })
    }

    vi.mocked(imageGetFetch).mockClear()
    await list('')
    for (const [, headers] of vi.mocked(imageGetFetch).mock.calls) expect(headers).toBeUndefined()
  })

  it('gives the dedicated list a short timeout and treats 403, 404 and 405 as absent', async () => {
    mockHost({ models: json([]) })
    await list()

    expect(imageGetFetch).toHaveBeenCalledWith(
      `${BASE_URL}/images/models`,
      expect.anything(),
      expect.objectContaining({ timeoutMs: 5_000, allowStatuses: [403, 404, 405] }),
    )
  })

  it('cancels the body of an absent dedicated list', async () => {
    mockHost({ models: json({ data: [{ id: 'a', output_modalities: ['image'] }] }) })
    await list()
    expect(missing.body!.cancel).toHaveBeenCalled()
  })

  describe('classifying by what an entry carries', () => {
    it('reads New API endpoint types, leaving img2img unknown without an edit type', async () => {
      mockHost({
        models: json({
          data: [
            { id: 'gpt-4o', supported_endpoint_types: ['openai'] },
            { id: 'claude', supported_endpoint_types: ['anthropic'] },
            {
              id: 'gpt-image-2',
              supported_endpoint_types: [
                'image-generation',
                'openai',
                'Generate image',
                'Edit image',
              ],
            },
            { id: 'plain-image', supported_endpoint_types: ['image-generation', 'openai'] },
          ],
        }),
      })

      expect(await list()).toEqual([
        { id: 'gpt-image-2', name: 'gpt-image-2', supportsImg2Img: true },
        { id: 'plain-image', name: 'plain-image', supportsImg2Img: undefined },
      ])
    })

    it('reads endpoint paths and sizes, ruling out editing when no edits path is listed', async () => {
      const sizes = ['1024x1024', '512x1024']
      mockHost({
        models: json({
          data: [
            { id: 'gpt-4o', name: 'GPT-4o', endpoints: ['/v1/chat/completions'] },
            { id: 'tts-1', endpoints: ['/v1/audio/speech'], voices: ['alloy'] },
            {
              id: 'krea-2-turbo',
              name: 'Krea: Krea 2 Turbo',
              endpoints: ['/v1/images/generations', '/v1/images/edits'],
              sizes,
            },
            { id: 'sdxl', endpoints: ['/v1/images/generations'], sizes },
          ],
        }),
      })

      expect(await list()).toEqual([
        {
          id: 'krea-2-turbo',
          name: 'Krea: Krea 2 Turbo',
          supportsImg2Img: true,
          supportedResolutions: sizes,
        },
        { id: 'sdxl', name: 'sdxl', supportsImg2Img: false, supportedResolutions: sizes },
      ])
    })

    it('reads architecture modalities, and never rules editing out from them', async () => {
      mockHost({
        models: json({
          data: [
            {
              id: 'gpt-4o',
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            },
            {
              id: 'Bytedance/seedream-4-5',
              name: 'Bytedance-Seedream-4.5',
              tags: ['text_to_image', 'image_to_image'],
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
            {
              id: 'Bytedance/edit',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
            },
          ],
        }),
      })

      expect(await list()).toEqual([
        { id: 'Bytedance/seedream-4-5', name: 'Bytedance-Seedream-4.5' },
        { id: 'Bytedance/edit', name: 'Bytedance/edit', supportsImg2Img: true },
      ])
    })

    it('puts output modalities before endpoint lists, which video models also carry', async () => {
      mockHost({
        models: json({
          data: [
            {
              id: 'veo',
              title: 'Veo',
              output_modalities: ['video'],
              supported_endpoints: ['/v1/images/generations'],
            },
            {
              id: 'flux',
              title: 'Flux',
              output_modalities: ['image'],
              supported_endpoints: ['/v1/images/generations', '/v1/images/edits'],
            },
          ],
        }),
      })

      expect(await list()).toEqual([{ id: 'flux', name: 'Flux', supportsImg2Img: true }])
    })

    it('matches modalities and endpoint paths in any case', async () => {
      mockHost({
        models: json({
          data: [
            { id: 'a', output_modalities: ['Image'] },
            { id: 'b', endpoints: ['/V1/Images/Generations'] },
            { id: 'c', output_modalities: ['text'] },
          ],
        }),
      })
      expect((await list()).map((m) => m.id)).toEqual(['a', 'b'])
    })

    it('labels an entry by name, display name, title, then id', async () => {
      mockHost({
        models: json([
          { id: 'a', name: 'N', display_name: 'D', title: 'T', output_modalities: ['image'] },
          { id: 'b', display_name: 'D', title: 'T', output_modalities: ['image'] },
          { id: 'c', title: 'T', output_modalities: ['image'] },
        ]),
      })

      expect((await list()).map((m) => m.name)).toEqual(['N', 'D', 'T'])
    })

    it('keeps an entry whose fields are shaped unlike the others', async () => {
      mockHost({
        models: json({
          data: [
            {
              id: 'odd',
              output_modalities: ['image'],
              endpoints: '/api/v1/images/models/odd/endpoints',
              supported_parameters: ['tools', 'temperature'],
              sizes: 'big',
            },
          ],
        }),
      })

      expect(await list()).toEqual([{ id: 'odd', name: 'odd' }])
    })

    it('reads a size list from supported_parameters.resolutions', async () => {
      mockHost({
        models: json([
          {
            id: 'a',
            output_modalities: ['image'],
            supported_parameters: { resolutions: ['768x768', '1k'] },
          },
        ]),
      })

      expect((await list())[0].supportedResolutions).toEqual(['768x768', '1k'])
    })
  })

  describe('choosing between the lists', () => {
    const chat = { id: 'gpt-4o', architecture: { output_modalities: ['text'] } }

    it('uses the dedicated list when it names image models', async () => {
      mockHost({
        models: json({ data: [chat] }),
        images: json({
          data: [
            {
              id: 'blackforestlabs/flux-3',
              name: 'FLUX.3',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
              supported_parameters: { resolutions: ['1024x1024', '2048x2048'] },
            },
          ],
        }),
      })

      expect(await list()).toEqual([
        {
          id: 'blackforestlabs/flux-3',
          name: 'FLUX.3',
          supportsImg2Img: true,
          supportedResolutions: ['1024x1024', '2048x2048'],
        },
      ])
    })

    it('takes a general entry the dedicated list names by id, name or model_name', async () => {
      mockHost({
        models: json({
          data: [
            chat,
            { id: 'Lykon/dreamshaper-8' },
            { id: 'by-name', name: 'Flux Pro' },
            { id: 'by-id' },
            { id: 'not-listed' },
          ],
        }),
        images: json({
          data: [
            { id: '0faf3168-uuid', model_name: 'Lykon/dreamshaper-8' },
            { id: 'x1', name: 'Flux Pro' },
            { id: 'by-id' },
          ],
        }),
      })

      expect((await list()).map((m) => m.id)).toEqual(['Lykon/dreamshaper-8', 'by-name', 'by-id'])
    })

    it('ignores a dedicated entry that matches nothing and does not classify', async () => {
      mockHost({
        models: json({ data: [chat, { id: 'Lykon/dreamshaper-8', output_modalities: ['image'] }] }),
        images: json({ data: [{ id: '0faf3168-uuid', model_name: 'elsewhere' }] }),
      })

      expect((await list()).map((m) => m.id)).toEqual(['Lykon/dreamshaper-8'])
    })

    it('merges capabilities by id, the dedicated list winning where it states them', async () => {
      mockHost({
        models: json({
          data: [
            { id: 'a', endpoints: ['/v1/images/generations'], sizes: ['512x512'] },
            { id: 'b', endpoints: ['/v1/images/generations'], sizes: ['512x512'] },
          ],
        }),
        images: json({
          data: [
            { id: 'a', output_modalities: ['image'] },
            { id: 'b', supported_parameters: { resolutions: ['1024x1024'] } },
          ],
        }),
      })

      expect(await list()).toEqual([
        { id: 'a', name: 'a', supportsImg2Img: false, supportedResolutions: ['512x512'] },
        { id: 'b', name: 'b', supportsImg2Img: false, supportedResolutions: ['1024x1024'] },
      ])
    })

    it('lists every model when nothing on the host says what it is', async () => {
      mockHost({ models: json({ data: [{ id: 'flux-dev' }, { id: 'gpt-4o', name: 'GPT-4o' }] }) })

      expect(await list()).toEqual([
        { id: 'flux-dev', name: 'flux-dev' },
        { id: 'gpt-4o', name: 'GPT-4o' },
      ])
    })

    it('lists nothing when the host classifies its models and has no image ones', async () => {
      mockHost({ models: json({ data: [chat, { id: 'embed', endpoints: ['/v1/embeddings'] }] }) })
      expect(await list()).toEqual([])
    })

    it('lists nothing when only some entries are classified and none is an image model', async () => {
      mockHost({ models: json({ data: [chat, { id: 'mystery' }] }) })
      expect(await list()).toEqual([])
    })

    it('accepts a bare array', async () => {
      mockHost({ models: json([{ id: 'flux-dev' }]) })
      expect((await list('')).map((m) => m.id)).toEqual(['flux-dev'])
    })

    it('skips entries that are not objects or carry no string id or name', async () => {
      mockHost({
        models: json({
          data: [null, 'flux', { id: 7 }, { name: 'only-name' }, { id: 'flux-dev', name: 3 }],
        }),
      })

      expect(await list('')).toEqual([
        { id: 'only-name', name: 'only-name' },
        { id: 'flux-dev', name: 'flux-dev' },
      ])
    })
  })

  describe('failures', () => {
    const image = { id: 'flux', output_modalities: ['image'] }

    it('rejects when the general list fails', async () => {
      mockHost({ models: failure })
      await expect(list()).rejects.toThrow('bad gateway')
    })

    it('rejects when every request fails', async () => {
      vi.mocked(imageGetFetch).mockRejectedValue(failure)
      await expect(list()).rejects.toThrow('bad gateway')
    })

    it('answers from the general list when the dedicated list fails', async () => {
      mockHost({
        models: json({ data: [{ id: 'gpt-4o', output_modalities: ['text'] }] }),
        images: failure,
      })
      expect(await list()).toEqual([])

      mockHost({ models: json({ data: [{ id: 'flux-dev' }] }), images: failure })
      expect((await list()).map((m) => m.id)).toEqual(['flux-dev'])
    })

    it('lists the general list’s image models when the dedicated list fails', async () => {
      mockHost({ models: json({ data: [image] }), images: failure })
      expect((await list()).map((m) => m.id)).toEqual(['flux'])
    })

    it('ignores a dedicated list that is not JSON', async () => {
      mockHost({ models: json({ data: [image] }), images: notJson })
      expect((await list()).map((m) => m.id)).toEqual(['flux'])
    })

    it('returns an empty list when the proxy lists nothing', async () => {
      mockHost({ models: json({ data: [] }) })
      expect(await list()).toEqual([])
    })

    it('returns an empty list, and makes no request, without a base URL', async () => {
      expect(await createOpenAICompatibleProvider({ apiKey: 'k' }).listModels()).toEqual([])
      expect(imageGetFetch).not.toHaveBeenCalled()
    })
  })
})
