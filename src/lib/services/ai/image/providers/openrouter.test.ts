import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError } from 'ai'
import type { ImageSpec } from '#lib/utils/image.ts'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

vi.mock('./fetchAdapter', () => ({ imageGetFetch: vi.fn() }))

const sdkFetch = vi.hoisted(() => vi.fn())
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => sdkFetch),
}))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { imageGetFetch } from './fetchAdapter'
import { createOpenRouterProvider } from './openrouter'

const PNG = 'iVBORw0KGgo='
const JPEG = '/9j/4AAQSkZJRg=='

const landscapeMedium: ImageSpec = { orientation: 'landscape', size: 'medium' }

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function provider(baseUrl?: string) {
  return createOpenRouterProvider({ apiKey: 'k', baseUrl })
}

function sentRequest() {
  const [url, init] = sdkFetch.mock.calls[0] as [string, RequestInit]
  return {
    url,
    headers: new Headers(init.headers),
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

describe('OpenRouter image provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdkFetch.mockImplementation(async () => jsonResponse({ data: [{ b64_json: 'AAA' }] }))
  })

  it('posts to /images with the ratio and a listed resolution, and returns the image', async () => {
    const result = await provider().generate({
      model: 'google/gemini-3-pro-image',
      prompt: 'a castle',
      spec: landscapeMedium,
      modelInfo: { supportedResolutions: ['1K', '2K', '4K'] },
    })

    const { url, headers, body } = sentRequest()
    expect(url).toBe('https://openrouter.ai/api/v1/images')
    expect(headers.get('Authorization')).toBe('Bearer k')
    expect(body).toEqual({
      model: 'google/gemini-3-pro-image',
      prompt: 'a castle',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '2K',
    })
    expect(result).toEqual({ base64: 'AAA' })
  })

  it.each([
    [undefined],
    [{}],
    [{ supportedResolutions: [] }],
    [{ supportedResolutions: ['auto'] }],
  ])('sends no resolution when the model lists none (%j)', async (modelInfo) => {
    await provider().generate({ model: 'm', prompt: 'p', spec: landscapeMedium, modelInfo })
    expect(sentRequest().body).not.toHaveProperty('resolution')
  })

  it('posts to the normalized base URL', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/api/v1')
    await provider(' https://raw.test// ').generate({
      model: 'm',
      prompt: 'p',
      spec: landscapeMedium,
    })

    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://raw.test// ')
    expect(sentRequest().url).toBe('https://normalized.test/api/v1/images')
  })

  it('sends references as input_references data URLs with their sniffed type', async () => {
    await provider().generate({
      model: 'm',
      prompt: 'p',
      spec: landscapeMedium,
      referenceImages: [PNG, JPEG],
    })

    expect(sentRequest().body.input_references).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG}` } },
    ])
  })

  it.each([
    ['tiny', ['1K', '2K', '4K'], '1K'],
    ['small', ['1K', '2K', '4K'], '1K'],
    ['medium', ['1K', '2K', '4K'], '2K'],
    ['large', ['1K', '2K'], '2K'],
    ['tiny', ['2K', '4K'], '2K'],
    ['large', ['1K'], '1K'],
    ['medium', ['512', '768', '1K', '1.5K', '2K'], '1.5K'],
    ['small', ['4K', '2K', 'auto', '1K'], '1K'],
  ] as const)('maps the %s tier on %j to resolution %s', async (size, listed, resolution) => {
    await provider().generate({
      model: 'm',
      prompt: 'p',
      spec: { orientation: 'landscape', size },
      modelInfo: { supportedResolutions: [...listed] },
    })
    expect(sentRequest().body.resolution).toBe(resolution)
  })

  it.each([
    ['portrait', '9:16'],
    ['square', '1:1'],
  ] as const)('maps %s to aspect ratio %s', async (orientation, ratio) => {
    await provider().generate({ model: 'm', prompt: 'p', spec: { orientation, size: 'small' } })
    expect(sentRequest().body.aspect_ratio).toBe(ratio)
  })

  it.each([
    ['landscape', ['1:1', '3:2', '2:3'], '3:2'],
    ['portrait', ['1:1', '3:2', '2:3'], '2:3'],
    ['landscape', ['1:1', '3:2', '2:3', 'auto'], '3:2'],
    ['landscape', ['1:1', '16:9'], '16:9'],
  ] as const)(
    'sends the closest listed ratio for %s on %j: %s',
    async (orientation, supportedAspectRatios, ratio) => {
      await provider().generate({
        model: 'm',
        prompt: 'p',
        spec: { orientation, size: 'small' },
        modelInfo: { supportedAspectRatios: [...supportedAspectRatios] },
      })
      expect(sentRequest().body.aspect_ratio).toBe(ratio)
    },
  )

  it('sends the spec ratio from the general list when the model lists none', async () => {
    await provider().generate({
      model: 'm',
      prompt: 'p',
      spec: landscapeMedium,
      modelInfo: { supportedAspectRatios: [] },
    })
    expect(sentRequest().body.aspect_ratio).toBe('16:9')
  })

  it('labels its fetch openrouter-image', () => {
    provider()
    expect(createSdkFetch).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'openrouter-image' }),
    )
  })

  it('honours a custom base URL', async () => {
    await provider('https://proxy.test/v1').generate({
      model: 'm',
      prompt: 'p',
      spec: landscapeMedium,
    })
    expect(sentRequest().url).toBe('https://proxy.test/v1/images')
  })

  it('rejects with the status on a failure and does not retry a 500', async () => {
    sdkFetch.mockImplementation(async () => jsonResponse({ error: { message: 'boom' } }, 500))

    const result = provider().generate({ model: 'm', prompt: 'p', spec: landscapeMedium })

    const error = await result.catch((e: unknown) => e)
    expect(APICallError.isInstance(error)).toBe(true)
    expect(error).toMatchObject({ statusCode: 500 })
    expect(sdkFetch).toHaveBeenCalledTimes(1)
  })
})

describe('OpenRouter model discovery', () => {
  const listed = (
    id: string,
    inputs: string[] | undefined,
    params: Record<string, unknown> = {},
  ) => ({
    id,
    name: `${id} name`,
    description: 'd',
    architecture: inputs && { input_modalities: inputs, output_modalities: ['image'] },
    supported_parameters: params,
  })

  const refs = (min: number, max: number) => ({ input_references: { type: 'range', min, max } })

  const models = async (...entries: unknown[]) => {
    vi.mocked(imageGetFetch).mockResolvedValue(jsonResponse({ data: entries }))
    return provider().listModels()
  }

  const modelOf = async (entry: unknown) => (await models(entry))[0]

  beforeEach(() => vi.mocked(imageGetFetch).mockReset())

  it('reads the image model list on the configured host', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(jsonResponse({ data: [] }))
    await provider('https://proxy.test/v1').listModels()

    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://proxy.test/v1/images/models',
      { Authorization: 'Bearer k' },
      expect.objectContaining({ serviceId: 'openrouter-image-models' }),
    )
  })

  it('sends the key it is given in preference to the configured one', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(jsonResponse({ data: [] }))
    await provider().listModels('other')
    expect(vi.mocked(imageGetFetch).mock.calls[0][1]).toEqual({ Authorization: 'Bearer other' })
  })

  it('sends no Authorization header without a key', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(jsonResponse({ data: [] }))
    await createOpenRouterProvider({ apiKey: '' }).listModels()
    expect(vi.mocked(imageGetFetch).mock.calls[0][1]).toBeUndefined()
  })

  it('lists image-only models and carries no price', async () => {
    const list = await models(
      listed('black-forest-labs/flux.2-pro', ['text']),
      listed('openai/gpt-image-1', ['text', 'image'], refs(0, 16)),
    )

    expect(list.map((m) => m.id)).toEqual(['black-forest-labs/flux.2-pro', 'openai/gpt-image-1'])
    expect(list[0]).toMatchObject({ name: 'black-forest-labs/flux.2-pro name', description: 'd' })
  })

  it('reads the reference count and an unlisted resolution as absent', async () => {
    const model = await modelOf(listed('openai/gpt-image-1', ['text', 'image'], refs(0, 16)))
    expect(model).toMatchObject({ supportsImg2Img: true, maxReferenceImages: 16 })
    expect(model.supportedResolutions).toBeUndefined()
    expect(model.requiresReferenceImage).toBeUndefined()
  })

  it('reads the listed resolutions verbatim', async () => {
    const model = await modelOf(
      listed('bytedance-seed/seedream-4.5', ['text', 'image'], {
        resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
        ...refs(0, 14),
      }),
    )
    expect(model.supportedResolutions).toEqual(['1K', '2K', '4K'])
  })

  it('reads the listed aspect ratios and leaves out those that are not w:h', async () => {
    const model = await modelOf(
      listed('openai/gpt-image-1', ['text', 'image'], {
        aspect_ratio: { type: 'enum', values: ['1:1', '3:2', '2:3', 'auto'] },
      }),
    )
    expect(model.supportedAspectRatios).toEqual(['1:1', '3:2', '2:3'])
  })

  it('reads a model that lists no aspect ratios as having none', async () => {
    const model = await modelOf(listed('meta/muse-image', ['text', 'image']))
    expect(model.supportedAspectRatios).toBeUndefined()
  })

  it('marks a model whose references are mandatory', async () => {
    const model = await modelOf(listed('recraft/recraft-v4-styles', ['text', 'image'], refs(1, 5)))
    expect(model).toMatchObject({ requiresReferenceImage: true, maxReferenceImages: 5 })
  })

  it('takes references on an image input with no listed count, and leaves the count open', async () => {
    const model = await modelOf(listed('meta/muse-image', ['text', 'image']))
    expect(model.supportsImg2Img).toBe(true)
    expect(model.maxReferenceImages).toBeUndefined()
  })

  it('refuses references on a text-only model that lists none', async () => {
    const model = await modelOf(listed('recraft/recraft-v4.1-flash', ['text']))
    expect(model.supportsImg2Img).toBe(false)
  })

  it('leaves img2img unknown when the inputs cannot be read', async () => {
    const model = await modelOf({ ...listed('m', undefined), architecture: 'text->image' })
    expect(model.supportsImg2Img).toBeUndefined()
  })

  it('keeps a model whose supported parameters are malformed', async () => {
    const model = await modelOf({ ...listed('m', ['text']), supported_parameters: 'many' })
    expect(model).toMatchObject({ id: 'm' })
    expect(model.maxReferenceImages).toBeUndefined()
    expect(model.supportedResolutions).toBeUndefined()
  })
})
