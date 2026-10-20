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

import { imageGetFetch } from './fetchAdapter'
import { createOpenAIProvider } from './openai'
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
  model: 'gpt-image-1',
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
      model: 'gpt-image-1',
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
    expect(form.get('model')).toBe('gpt-image-1')
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

  it('goes to a custom base URL', async () => {
    await createOpenAIProvider({ apiKey: 'k', baseUrl: 'https://proxy.test/v1/' }).generate(
      options(),
    )
    expect(lastCall().url).toBe('https://proxy.test/v1/images/generations')
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

describe('OpenAI model listing', () => {
  const modelsResponse = (body: unknown) =>
    ({ ok: true, json: async () => body }) as unknown as Response

  it('keeps the gpt-image and chatgpt-image ids, each taking references', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({
        data: [
          { id: 'dall-e-3' },
          { id: 'gpt-image-1' },
          { id: 'chatgpt-image-latest' },
          { id: 'gpt-4o' },
        ],
      }),
    )
    const models = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(models.map((m) => [m.id, m.supportsImg2Img, m.maxReferenceImages])).toEqual([
      ['gpt-image-1', true, undefined],
      ['chatgpt-image-latest', true, undefined],
    ])
  })

  it('skips entries without a string id', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [null, 'gpt-image-1', { id: 7 }, { id: 'gpt-image-1' }] }),
    )
    const models = await createOpenAIProvider({ apiKey: 'k' }).listModels('k')
    expect(models.map((m) => m.id)).toEqual(['gpt-image-1'])
  })

  it('lists against a custom base URL the same way', async () => {
    vi.mocked(imageGetFetch).mockResolvedValue(
      modelsResponse({ data: [{ id: 'gpt-image-1' }, { id: 'flux-dev' }] }),
    )
    const models = await createOpenAIProvider({
      apiKey: 'k',
      baseUrl: 'https://proxy.test/v1',
    }).listModels('k')
    expect(models.map((m) => m.id)).toEqual(['gpt-image-1'])
    expect(imageGetFetch).toHaveBeenCalledWith(
      'https://proxy.test/v1/models',
      { Authorization: 'Bearer k' },
      expect.anything(),
    )
  })
})
