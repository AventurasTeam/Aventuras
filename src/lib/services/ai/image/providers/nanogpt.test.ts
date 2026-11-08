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
})

const listed = (
  id: string,
  over: {
    supported_parameters?: Record<string, unknown>
    capabilities?: unknown
    architecture?: unknown
  } = {},
) => ({
  id,
  name: id,
  architecture: { input_modalities: ['text'], output_modalities: ['image'] },
  capabilities: { image_generation: true, image_to_image: false },
  ...over,
  supported_parameters: { resolutions: ['1k'], ...over.supported_parameters },
})

const withModels = (...entries: unknown[]) =>
  vi.mocked(imageGetFetch).mockResolvedValue(modelsResponse({ object: 'list', data: entries }))

const capabilitiesOf = async (entry: unknown, id = 'm') => {
  withModels(entry)
  const models = await createNanoGPTProvider({ apiKey: 'k' }).listModels()
  return models.find((m) => m.id === id)
}

describe('NanoGPT model catalogue', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads the documented list on the default host', async () => {
    withModels(listed('m'))
    await createNanoGPTProvider({ apiKey: 'k' }).listModels()
    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://api.nano-gpt.com/api/v1/images/models',
      { Authorization: 'Bearer k' },
      expect.objectContaining({ serviceId: 'nanogpt-image-models' }),
    )
  })

  it('sends no Authorization header without a key', async () => {
    withModels(listed('m'))
    await createNanoGPTProvider({ apiKey: '' }).listModels()
    expect(vi.mocked(imageGetFetch).mock.calls[0][1]).toBeUndefined()
  })

  it('reads resolutions and keeps only the aspect ratios that are ratios', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        supported_parameters: {
          resolutions: ['1k', '2k'],
          aspect_ratio: ['auto', '1:1', '16:9', 'match_input_image', ''],
        },
      }),
    )
    expect(model).toMatchObject({
      supportedResolutions: ['1k', '2k'],
      supportedAspectRatios: ['1:1', '16:9'],
    })
  })

  it('leaves the lists unset when a model offers none', async () => {
    const model = await capabilitiesOf(
      listed('m', { supported_parameters: { resolutions: [], aspect_ratio: ['auto'] } }),
    )
    expect(model?.supportedResolutions).toBeUndefined()
    expect(model?.supportedAspectRatios).toBeUndefined()
  })

  it('takes the reference limit from max_input_images, then from the constraints', async () => {
    expect(
      (await capabilitiesOf(listed('m', { supported_parameters: { max_input_images: 3 } })))
        ?.maxReferenceImages,
    ).toBe(3)
    expect(
      (
        await capabilitiesOf(
          listed('m', { supported_parameters: { input_image_constraints: { max_items: 5 } } }),
        )
      )?.maxReferenceImages,
    ).toBe(5)
  })

  it('reads an image-to-image model with no count as having no known limit', async () => {
    const model = await capabilitiesOf(
      listed('m', { capabilities: { image_to_image: true }, supported_parameters: {} }),
    )
    expect(model).toMatchObject({ supportsImg2Img: true })
    expect(model?.maxReferenceImages).toBeUndefined()
  })

  it('lets a reference count outvote image_to_image: false', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        capabilities: { image_to_image: false },
        supported_parameters: { max_input_images: 4 },
      }),
    )
    expect(model).toMatchObject({ supportsImg2Img: true, maxReferenceImages: 4 })
  })

  it('reports a model with neither signal as not taking references', async () => {
    expect((await capabilitiesOf(listed('m')))?.supportsImg2Img).toBe(false)
  })

  it('leaves supportsImg2Img unknown when the list says nothing about it', async () => {
    const model = await capabilitiesOf({ id: 'm', supported_parameters: {} })
    expect(model?.supportsImg2Img).toBeUndefined()
  })

  it('marks a model that takes images and no text as needing a reference', async () => {
    const edits = listed('m', {
      architecture: { input_modalities: ['image'], output_modalities: ['image'] },
    })
    expect((await capabilitiesOf(edits))?.requiresReferenceImage).toBe(true)
    expect((await capabilitiesOf(listed('m')))?.requiresReferenceImage).toBeUndefined()
  })

  it('does not mark a model as needing a reference when its architecture is unreadable', async () => {
    expect(
      (await capabilitiesOf(listed('m', { architecture: 'oops' })))?.requiresReferenceImage,
    ).toBeUndefined()
    expect(
      (await capabilitiesOf(listed('m', { architecture: { input_modalities: [] } })))
        ?.requiresReferenceImage,
    ).toBeUndefined()
  })

  it('takes the tighter of the route and provider limits', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        supported_parameters: {
          input_image_constraints: {
            max_items: 3,
            route: {
              min_width: 8,
              min_height: 8,
              max_width: 16384,
              max_height: 16384,
              max_bytes: 31457280,
              formats: ['png', 'jpeg', 'webp'],
            },
            provider: {
              min_width: 256,
              min_height: 128,
              max_bytes: 10485760,
              formats: ['png', 'jpeg'],
            },
          },
        },
      }),
    )
    expect(model?.referenceConstraints).toEqual({
      maxBytes: 10485760,
      minSide: 256,
      maxSide: 16384,
      mimeTypes: ['image/png', 'image/jpeg'],
    })
  })

  it('does not let a side that lists nothing restrict', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        supported_parameters: {
          input_image_constraints: {
            route: { formats: ['png', 'webp'], max_bytes: 100 },
            provider: { max_bytes: 50 },
          },
        },
      }),
    )
    expect(model?.referenceConstraints).toEqual({
      maxBytes: 50,
      minSide: undefined,
      maxSide: undefined,
      mimeTypes: ['image/png', 'image/webp'],
    })
  })

  it('reads the typed parameter shape the docs describe', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        supported_parameters: {
          resolutions: undefined,
          resolution: { type: 'enum', values: ['1k', '4k'], default: '1k' },
          aspect_ratio: { type: 'enum', values: ['1:1', '3:2'] },
          input_references: { type: 'range', min: 1, max: 6 },
        },
      }),
    )
    expect(model).toMatchObject({
      supportedResolutions: ['1k', '4k'],
      supportedAspectRatios: ['1:1', '3:2'],
      maxReferenceImages: 6,
      requiresReferenceImage: true,
    })
  })

  it('keeps a model whose other fields are malformed', async () => {
    const model = await capabilitiesOf(
      listed('m', {
        supported_parameters: { resolutions: ['1k'], max_input_images: 'many', aspect_ratio: 7 },
        capabilities: 'yes',
      }),
    )
    expect(model).toMatchObject({ id: 'm', supportedResolutions: ['1k'] })
    expect(model?.maxReferenceImages).toBeUndefined()
  })

  it('skips an entry with no id', async () => {
    withModels({ name: 'nameless' }, listed('m'))
    const models = await createNanoGPTProvider({ apiKey: 'k' }).listModels()
    expect(models.map((m) => m.id)).toEqual(['m'])
  })
})

describe('NanoGPT getModelCapabilities', () => {
  const endpointsReply = (body: unknown, status = 200) =>
    ({
      ok: status < 400,
      status,
      json: async () => body,
      body: { cancel: vi.fn() },
    }) as unknown as Response

  const provider = () => createNanoGPTProvider({ apiKey: 'k' })

  // The models the registry hands over: the provider's own list, read before the lookup.
  const catalogue = async (...entries: unknown[]) => {
    withModels(...entries)
    const models = await provider().listModels()
    vi.mocked(imageGetFetch).mockReset()
    return models
  }

  beforeEach(() => vi.resetAllMocks())

  it('resolves an id the list lacks through its endpoints, to the listed entry', async () => {
    const models = await catalogue(
      listed('krea-2/turbo', {
        architecture: { input_modalities: ['image'], output_modalities: ['image'] },
        supported_parameters: { resolutions: ['square_hd', 'landscape_16_9'] },
      }),
    )
    vi.mocked(imageGetFetch).mockResolvedValueOnce(
      endpointsReply({
        id: 'krea-2/turbo',
        endpoints: [{ supported_parameters: { resolutions: ['stale'] } }],
      }),
    )
    const found = await provider().getModelCapabilities?.('fal-ai/krea-2/turbo', models)
    expect(found).toMatchObject({
      supportedResolutions: ['square_hd', 'landscape_16_9'],
      requiresReferenceImage: true,
    })
    expect(vi.mocked(imageGetFetch).mock.calls).toEqual([
      [
        'https://api.nano-gpt.com/api/v1/images/models/fal-ai/krea-2/turbo/endpoints',
        { Authorization: 'Bearer k' },
        expect.objectContaining({ allowStatuses: [404] }),
      ],
    ])
  })

  it('reads the endpoint alone when its canonical id is not listed', async () => {
    vi.mocked(imageGetFetch).mockResolvedValueOnce(
      endpointsReply({
        id: 'x/y',
        endpoints: [
          {
            supported_parameters: { resolutions: ['1k'] },
            input_reference_constraints: { max_items: 2, route: { max_bytes: 9 } },
            capabilities: { image_to_image: true },
          },
        ],
      }),
    )
    const found = await provider().getModelCapabilities?.('a/x/y', [])
    expect(found).toMatchObject({
      supportedResolutions: ['1k'],
      supportsImg2Img: true,
      maxReferenceImages: 2,
      referenceConstraints: { maxBytes: 9 },
    })
  })

  it('returns undefined for a model NanoGPT does not know', async () => {
    const reply = endpointsReply({ error: { code: 'image_model_not_found' } }, 404)
    vi.mocked(imageGetFetch).mockResolvedValueOnce(reply)
    await expect(provider().getModelCapabilities?.('nope', [])).resolves.toBeUndefined()
    expect(reply.body?.cancel).toHaveBeenCalled()
  })

  it('forwards the abort signal to its request', async () => {
    vi.mocked(imageGetFetch).mockResolvedValueOnce(endpointsReply({}, 404))
    const { signal } = new AbortController()

    await provider().getModelCapabilities?.('nope', [], signal)

    expect(vi.mocked(imageGetFetch).mock.calls[0][2]?.signal).toBe(signal)
  })

  it('rejects when the request fails', async () => {
    vi.mocked(imageGetFetch).mockRejectedValueOnce(new Error('Image API error 500: boom'))
    await expect(provider().getModelCapabilities?.('nope', [])).rejects.toThrow('boom')
  })

  it('rejects on an endpoint reply it cannot read, rather than reporting no capabilities', async () => {
    vi.mocked(imageGetFetch).mockResolvedValueOnce(endpointsReply({ unexpected: true }))
    await expect(provider().getModelCapabilities?.('nope', [])).rejects.toThrow(
      'unreadable endpoint reply',
    )
  })
})
