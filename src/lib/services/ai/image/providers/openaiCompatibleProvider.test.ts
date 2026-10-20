import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

const sent = vi.hoisted(() => ({
  calls: [] as { url: string; init: RequestInit }[],
  serviceIds: [] as string[],
}))

// The recording fetch stands in for the Tauri transport; everything above it is the real SDK.
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: (options: { serviceId: string }) => {
    sent.serviceIds.push(options.serviceId)
    return async (input: RequestInfo | URL, init: RequestInit = {}) => {
      sent.calls.push({ url: input.toString(), init })
      return new Response(JSON.stringify({ data: [{ b64_json: 'AAA' }] }), {
        headers: { 'content-type': 'application/json' },
      })
    }
  },
}))
vi.mock('./fetchAdapter', () => ({ imageGetFetch: vi.fn() }))

import { imageGetFetch } from './fetchAdapter'
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

const lastCall = () => sent.calls.at(-1)!

beforeEach(() => {
  sent.calls.length = 0
  sent.serviceIds.length = 0
  vi.clearAllMocks()
})

describe('OpenAI Compatible image generation', () => {
  it('posts a JSON generation that asks for b64_json', async () => {
    const result = await createOpenAICompatibleProvider({
      apiKey: 'k',
      baseUrl: BASE_URL,
    }).generate(options())

    expect(result).toEqual({ base64: 'AAA' })
    expect(lastCall().url).toBe(`${BASE_URL}/images/generations`)
    expect(new Headers(lastCall().init.headers).get('authorization')).toBe('Bearer k')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      model: 'flux-dev',
      prompt: 'a castle',
      n: 1,
      size: '1536x1536',
      response_format: 'b64_json',
    })
  })

  it('posts references as an edit that asks for b64_json', async () => {
    await createOpenAICompatibleProvider({ apiKey: 'k', baseUrl: BASE_URL }).generate(
      options({ referenceImages: [PNG] }),
    )

    expect(lastCall().url).toBe(`${BASE_URL}/images/edits`)
    const form = lastCall().init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('response_format')).toBe('b64_json')
    expect((form.getAll('image') as Blob[]).map((part) => part.type)).toEqual(['image/png'])
  })

  it('sends no Authorization header without a key', async () => {
    await createOpenAICompatibleProvider({ apiKey: '', baseUrl: BASE_URL }).generate(options())
    expect(new Headers(lastCall().init.headers).has('authorization')).toBe(false)
  })

  it('tolerates a trailing slash on the base URL', async () => {
    await createOpenAICompatibleProvider({ apiKey: '', baseUrl: `${BASE_URL}/` }).generate(
      options(),
    )
    expect(lastCall().url).toBe(`${BASE_URL}/images/generations`)
  })

  it('sends its requests under the openai-compatible-image debug id', async () => {
    await createOpenAICompatibleProvider({ apiKey: '', baseUrl: BASE_URL }).generate(options())
    expect(sent.serviceIds).toEqual(['openai-compatible-image'])
  })

  it.each([undefined, '', '   '])('throws without a base URL (%j)', async (baseUrl) => {
    await expect(
      createOpenAICompatibleProvider({ apiKey: 'k', baseUrl }).generate(options()),
    ).rejects.toThrow('requires a custom base URL')
    expect(sent.calls).toHaveLength(0)
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
