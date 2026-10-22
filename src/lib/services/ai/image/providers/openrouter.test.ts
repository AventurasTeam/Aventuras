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

import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
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

  it('posts to /images with the ratio and resolution, and returns the image', async () => {
    const result = await provider().generate({
      model: 'google/gemini-2.5-flash-image',
      prompt: 'a castle',
      spec: landscapeMedium,
    })

    const { url, headers, body } = sentRequest()
    expect(url).toBe('https://openrouter.ai/api/v1/images')
    expect(headers.get('Authorization')).toBe('Bearer k')
    expect(body).toEqual({
      model: 'google/gemini-2.5-flash-image',
      prompt: 'a castle',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '1.5K',
    })
    expect(result).toEqual({ base64: 'AAA' })
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
    ['tiny', '512'],
    ['small', '1K'],
    ['medium', '1.5K'],
    ['large', '2K'],
  ] as const)('maps the %s tier to resolution %s', async (size, resolution) => {
    await provider().generate({
      model: 'm',
      prompt: 'p',
      spec: { orientation: 'landscape', size },
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
