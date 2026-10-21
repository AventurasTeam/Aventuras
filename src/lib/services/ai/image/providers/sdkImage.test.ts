import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APICallError } from 'ai'
import type { ImageModelV4 } from '@ai-sdk/provider'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => 'SDK_FETCH'),
}))

import { createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

const apiError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: 'https://img.test/v1/images/generations',
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
  })

const success = {
  images: ['AAA'],
  warnings: [],
  response: { timestamp: new Date(), modelId: 'fake', headers: undefined },
}

/** A bare `ImageModelV4`, so the real `generateImage` and `wrapImageModel` run. */
const mockGenerate = (impl?: ImageModelV4['doGenerate']) => vi.fn<ImageModelV4['doGenerate']>(impl)

function fakeModel(doGenerate: ImageModelV4['doGenerate']): ImageModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'fake-model',
    maxImagesPerCall: 1,
    doGenerate,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('generateSdkImage', () => {
  it('returns the first image as base64', async () => {
    const doGenerate = mockGenerate().mockResolvedValue(success)
    const result = await generateSdkImage({ model: fakeModel(doGenerate), prompt: 'a castle' })
    expect(result).toEqual({ base64: 'AAA' })
    expect(doGenerate.mock.lastCall![0]).toMatchObject({ prompt: 'a castle', files: undefined })
  })

  it('retries a 429 after the backoff', async () => {
    const doGenerate = mockGenerate()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValue(success)

    const result = generateSdkImage({ model: fakeModel(doGenerate), prompt: 'x' })
    await vi.advanceTimersByTimeAsync(11_000)

    await expect(result).resolves.toEqual({ base64: 'AAA' })
    expect(doGenerate).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 500, which may already have been billed', async () => {
    const doGenerate = mockGenerate().mockRejectedValue(apiError(500))

    await expect(
      generateSdkImage({ model: fakeModel(doGenerate), prompt: 'x' }),
    ).rejects.toMatchObject({ statusCode: 500 })
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })

  it('rejects with an AbortError when the call is aborted', async () => {
    const controller = new AbortController()
    const doGenerate = mockGenerate(
      ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          )
        }),
    )

    const result = generateSdkImage({
      model: fakeModel(doGenerate),
      prompt: 'x',
      signal: controller.signal,
    })
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    await settled
  })

  it('hands references to the model as files with a detected media type', async () => {
    const doGenerate = mockGenerate().mockResolvedValue(success)

    await generateSdkImage({
      model: fakeModel(doGenerate),
      prompt: 'a castle',
      referenceImages: ['iVBORw0KGgo=', '/9j/4AAQSkZJRg=='],
    })

    const files = doGenerate.mock.lastCall![0].files!
    expect(files).toHaveLength(2)
    expect(files.map((f) => (f.type === 'file' ? f.mediaType : f.type))).toEqual([
      'image/png',
      'image/jpeg',
    ])
  })

  it('passes size, aspect ratio and provider options through', async () => {
    const doGenerate = mockGenerate().mockResolvedValue(success)

    await generateSdkImage({
      model: fakeModel(doGenerate),
      prompt: 'x',
      size: '1024x1024',
      providerOptions: { fake: { quality: 'high' } },
    })

    expect(doGenerate.mock.lastCall![0]).toMatchObject({
      size: '1024x1024',
      providerOptions: { fake: { quality: 'high' } },
    })
  })
})

describe('createImageSdkFetch', () => {
  it('uses the image timeout and labels errors as image generation', () => {
    expect(createImageSdkFetch('openai-image')).toBe('SDK_FETCH')
    expect(createSdkFetch).toHaveBeenCalledWith({
      serviceId: 'openai-image',
      timeoutMs: 300000,
      what: 'Image generation',
    })
  })
})

describe('a url-only OpenAI-compatible reply', () => {
  const PNG_BYTES = Uint8Array.from([137, 80, 78, 71])

  const run = async (imageUrl: string) => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/images/generations')
        ? Response.json({ data: [{ url: imageUrl }] })
        : new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }),
    )
    const provider = createOpenAICompatible({
      name: 'openaiCompatible',
      baseURL: 'https://api.test/v1',
      apiKey: 'secret',
      fetch: fetchMock,
    })
    const result = await generateSdkImage({ model: provider.imageModel('m'), prompt: 'x' })
    return { result, fetchMock }
  }

  const authorization = (call: Parameters<typeof fetch>) =>
    new Headers(call[1]?.headers).get('authorization')

  it('downloads the image through the injected fetch', async () => {
    const { result, fetchMock } = await run('https://cdn.test/a.png')

    expect(result).toEqual({ base64: 'iVBORw==' })
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.test/v1/images/generations',
      'https://cdn.test/a.png',
    ])
  })

  it('sends the key to the API origin only', async () => {
    const cross = await run('https://cdn.test/a.png')
    expect(authorization(cross.fetchMock.mock.calls[0])).toBe('Bearer secret')
    expect(authorization(cross.fetchMock.mock.calls[1])).toBeNull()

    const same = await run('https://api.test/files/a.png')
    expect(authorization(same.fetchMock.mock.calls[1])).toBe('Bearer secret')
  })

  it('follows a redirect hop by hop and drops the key once it leaves the API origin', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/images/generations')) {
        return Response.json({ data: [{ url: 'https://api.test/files/a.png' }] })
      }
      if (url === 'https://api.test/files/a.png') {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.test/a.png' } })
      }
      return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } })
    })
    const provider = createOpenAICompatible({
      name: 'openaiCompatible',
      baseURL: 'https://api.test/v1',
      apiKey: 'secret',
      fetch: fetchMock,
    })

    const result = await generateSdkImage({ model: provider.imageModel('m'), prompt: 'x' })

    expect(result).toEqual({ base64: 'iVBORw==' })
    const downloads = fetchMock.mock.calls.slice(1)
    expect(downloads.map(([url]) => String(url))).toEqual([
      'https://api.test/files/a.png',
      'https://cdn.test/a.png',
    ])
    expect(downloads.map((call) => call[1]?.redirect)).toEqual(['manual', 'manual'])
    expect(authorization(downloads[0])).toBe('Bearer secret')
    expect(authorization(downloads[1])).toBeNull()
  })
})
