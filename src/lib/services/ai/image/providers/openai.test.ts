import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

const sent = vi.hoisted(() => ({
  calls: [] as { url: string; init: RequestInit }[],
  replies: [] as (() => Response)[],
  serviceIds: [] as string[],
}))

// The recording fetch stands in for the Tauri transport; everything above it is the real SDK.
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: (options: { serviceId: string }) => {
    sent.serviceIds.push(options.serviceId)
    return async (input: RequestInfo | URL, init: RequestInit = {}) => {
      sent.calls.push({ url: input.toString(), init })
      return (sent.replies.shift() ?? okReply)()
    }
  },
}))
vi.mock('./fetchAdapter', () => ({ imageGetFetch: vi.fn() }))

vi.mock('#lib/utils/url.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/url.ts')>()
  return { ...actual, normalizeBaseUrl: vi.fn(actual.normalizeBaseUrl) }
})

import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { imageGetFetch } from './fetchAdapter'
import { createOpenAIProvider, openaiModelCapabilities } from './openai'
import { IMAGE_SIZE_TIERS, type ImageSpec } from '#lib/utils/image.ts'
import type { ImageGenerateOptions } from './types'

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
const okReply = json({ data: [{ b64_json: 'AAA' }] })

const PNG = 'iVBORw0KGgo='
const JPEG = '/9j/4AAQSkZJRg=='

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'gpt-image-2',
  prompt: 'a castle',
  spec: { orientation: 'square', size: 'medium' },
  ...over,
})

const lastCall = () => sent.calls.at(-1)!
const lastJson = () => JSON.parse(lastCall().init.body as string)
const lastForm = () => lastCall().init.body as FormData

beforeEach(() => {
  sent.calls.length = 0
  sent.replies.length = 0
  vi.clearAllMocks()
})

describe('OpenAI image generation', () => {
  it('posts a JSON generation with no response_format for gpt-image models', async () => {
    const result = await createOpenAIProvider({ apiKey: 'k' }).generate(options())

    expect(result).toEqual({ base64: 'AAA' })
    expect(lastCall().url).toBe('https://api.openai.com/v1/images/generations')
    expect(lastCall().init.method).toBe('POST')
    expect(new Headers(lastCall().init.headers).get('authorization')).toBe('Bearer k')
    expect(lastJson()).toEqual({
      model: 'gpt-image-2',
      prompt: 'a castle',
      n: 1,
      size: '1536x1536',
    })
  })

  it('still asks other model ids for b64_json', async () => {
    await createOpenAIProvider({ apiKey: 'k' }).generate(options({ model: 'some-image-model' }))
    expect(lastJson().response_format).toBe('b64_json')
  })

  it('posts one reference as an edit with a single image part', async () => {
    await createOpenAIProvider({ apiKey: 'k' }).generate(options({ referenceImages: [PNG] }))

    expect(lastCall().url).toBe('https://api.openai.com/v1/images/edits')
    const form = lastForm()
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('prompt')).toBe('a castle')
    expect(form.get('n')).toBe('1')
    expect(form.get('size')).toBe('1536x1536')
    expect(form.has('response_format')).toBe(false)
    const parts = form.getAll('image') as Blob[]
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe('image/png')
  })

  it('posts several references as repeated image[] parts', async () => {
    await createOpenAIProvider({ apiKey: 'k' }).generate(options({ referenceImages: [PNG, JPEG] }))

    const form = lastForm()
    expect(form.has('image')).toBe(false)
    expect((form.getAll('image[]') as Blob[]).map((part) => part.type)).toEqual([
      'image/png',
      'image/jpeg',
    ])
  })

  it('goes to the normalized base URL', async () => {
    vi.mocked(normalizeBaseUrl).mockReturnValueOnce('https://normalized.test/v1')
    await createOpenAIProvider({ apiKey: 'k', baseUrl: ' https://proxy.test/v1// ' }).generate(
      options(),
    )
    expect(normalizeBaseUrl).toHaveBeenCalledWith(' https://proxy.test/v1// ')
    expect(lastCall().url).toBe('https://normalized.test/v1/images/generations')
  })

  it('sends its requests under the openai-image debug id', () => {
    sent.serviceIds.length = 0
    createOpenAIProvider({ apiKey: 'k' })
    expect(sent.serviceIds).toEqual(['openai-image'])
  })

  it('fails when the reply carries only a url', async () => {
    sent.replies.push(json({ data: [{ url: 'https://img.test/a.png' }] }))
    await expect(createOpenAIProvider({ apiKey: 'k' }).generate(options())).rejects.toThrow(
      'Invalid JSON response',
    )
  })

  it('surfaces the provider error message', async () => {
    sent.replies.push(json({ error: { message: 'Billing hard limit reached' } }, 400))
    await expect(createOpenAIProvider({ apiKey: 'k' }).generate(options())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Billing hard limit reached',
    })
    expect(sent.calls).toHaveLength(1)
  })

  describe('after a 429', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('retries once the backoff has passed', async () => {
      sent.replies.push(json({ error: { message: 'Rate limited' } }, 429))

      const result = createOpenAIProvider({ apiKey: 'k' }).generate(options())
      await vi.advanceTimersByTimeAsync(11_000)

      await expect(result).resolves.toEqual({ base64: 'AAA' })
      expect(sent.calls).toHaveLength(2)
    })

    it('waits for Retry-After', async () => {
      sent.replies.push(json({ error: { message: 'Rate limited' } }, 429, { 'retry-after': '2' }))

      const result = createOpenAIProvider({ apiKey: 'k' }).generate(options())
      await vi.advanceTimersByTimeAsync(1_999)
      expect(sent.calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)

      await expect(result).resolves.toEqual({ base64: 'AAA' })
      expect(sent.calls).toHaveLength(2)
    })

    it('does not retry a 500', async () => {
      sent.replies.push(json({ error: { message: 'Server error' } }, 500))
      await expect(createOpenAIProvider({ apiKey: 'k' }).generate(options())).rejects.toMatchObject(
        {
          statusCode: 500,
        },
      )
      expect(sent.calls).toHaveLength(1)
    })
  })
})

describe('OpenAI image size', () => {
  const sizeFor = async (
    model: string,
    orientation: ImageSpec['orientation'],
    size: ImageSpec['size'],
    referenceImages?: string[],
  ) => {
    const provider = createOpenAIProvider({ apiKey: 'k' })
    await provider.generate(
      options({
        model,
        spec: { orientation, size },
        modelInfo: openaiModelCapabilities(model),
        referenceImages,
      }),
    )
    return referenceImages ? lastForm().get('size') : lastJson().size
  }

  it.each([
    ['square', ['816x816', '1024x1024', '1536x1536', '2048x2048']],
    ['landscape', ['1088x608', '1088x608', '1536x864', '2048x1152']],
    ['portrait', ['608x1088', '608x1088', '864x1536', '1152x2048']],
  ] as const)(
    'sends a %s gpt-image-2 request real dimensions at or above the pixel floor',
    async (orientation, expected) => {
      for (const [i, tier] of IMAGE_SIZE_TIERS.entries()) {
        expect(await sizeFor('gpt-image-2', orientation, tier)).toBe(expected[i])
      }
    },
  )

  it.each([
    ['square', '1024x1024'],
    ['landscape', '1536x1024'],
    ['portrait', '1024x1536'],
  ] as const)(
    'sends a %s request to a fixed-size model its standard size',
    async (orientation, expected) => {
      for (const tier of IMAGE_SIZE_TIERS) {
        expect(await sizeFor('gpt-image-1.5', orientation, tier)).toBe(expected)
      }
    },
  )

  it('sends the same size on the edits endpoint', async () => {
    expect(await sizeFor('gpt-image-1.5', 'landscape', 'medium', [PNG])).toBe('1536x1024')
    expect(await sizeFor('gpt-image-2', 'landscape', 'tiny', [PNG])).toBe('1088x608')
  })

  it('sends real dimensions to a model with no snapshot or an unlisted id', async () => {
    const provider = createOpenAIProvider({ apiKey: 'k' })
    await provider.generate(
      options({ spec: { orientation: 'landscape', size: 'tiny' }, modelInfo: undefined }),
    )
    expect(lastJson().size).toBe('1088x608')

    await provider.generate(
      options({
        model: 'gpt-image-9',
        spec: { orientation: 'landscape', size: 'medium' },
        modelInfo: openaiModelCapabilities('gpt-image-9'),
      }),
    )
    expect(lastJson().size).toBe('1536x864')
  })
})

describe('OpenAI model listing', () => {
  const modelsResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response

  it('keeps the gpt-image and chatgpt-image ids, each taking references', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        data: [
          { id: 'dall-e-3' },
          { id: 'gpt-image-2' },
          { id: 'chatgpt-image-latest' },
          { id: 'gpt-4o' },
        ],
      }),
    )
    const models = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(models.map((m) => [m.id, m.supportsImg2Img, m.maxReferenceImages])).toEqual([
      ['gpt-image-2', true, 16],
      ['chatgpt-image-latest', true, 16],
    ])
  })

  it('lists sizes only for the models that take a fixed set', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1.5' }] }),
    )
    const [free, fixed] = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(free.supportedResolutions).toBeUndefined()
    expect(fixed.supportedResolutions).toEqual(['1024x1024', '1536x1024', '1024x1536'])
  })

  it('gives a dated snapshot its undated model’s capabilities', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        data: [{ id: 'gpt-image-2.5-flare' }, { id: 'gpt-image-2.5-flare-2026-09-08' }],
      }),
    )
    const [model, snapshot] = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(snapshot).toMatchObject({ id: 'gpt-image-2.5-flare-2026-09-08' })
    expect(snapshot.maxReferenceImages).toBe(model.maxReferenceImages)
  })

  it('knows only that an unlisted image model takes references', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(modelsResponse({ data: [{ id: 'gpt-image-9' }] }))
    const [model] = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(model.supportsImg2Img).toBe(true)
    expect(model.maxReferenceImages).toBeUndefined()
    expect(model.supportedResolutions).toBeUndefined()
  })

  it('skips entries without a string id', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [null, 'gpt-image-2', { id: 7 }, { id: 'gpt-image-2' }] }),
    )
    const models = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(models.map((m) => m.id)).toEqual(['gpt-image-2'])
  })

  it('lists against a custom base URL the same way', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [{ id: 'gpt-image-2' }, { id: 'flux-dev' }] }),
    )
    const models = await createOpenAIProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.test/v1',
    }).listModels('k')
    expect(models.map((m) => m.id)).toEqual(['gpt-image-2'])
    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://proxy.test/v1/models',
      { Authorization: 'Bearer k' },
      expect.anything(),
    )
  })
})

describe('OpenAI model capabilities', () => {
  it('answers from the table without a request or a key', () => {
    expect(openaiModelCapabilities('gpt-image-1.5')).toMatchObject({
      supportsImg2Img: true,
      maxReferenceImages: 16,
      supportedResolutions: ['1024x1024', '1536x1024', '1024x1536'],
    })
    expect(imageGetFetch).not.toHaveBeenCalled()
  })

  it('does not know a model that is not an image model', () => {
    expect(openaiModelCapabilities('gpt-4o')).toBeUndefined()
    expect(openaiModelCapabilities('dall-e-3')).toBeUndefined()
  })
})
