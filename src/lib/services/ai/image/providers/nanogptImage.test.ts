import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APICallError, InvalidResponseDataError, NoImageGeneratedError } from 'ai'
import type { ImageModelV4CallOptions } from '@ai-sdk/provider'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(),
}))

import { generateSdkImage } from './sdkImage'
import { createNanoGPTImage } from './nanogptImage'

const BASE_URL = 'https://api.nano-gpt.com/api/v1'
const PNG = 'iVBORw0KGgo='
const JPEG = '/9j/4AAQSkZJRg=='
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71])
const PNG_BYTES_BASE64 = 'iVBORw=='

// Requests and replies as captured from the live API.
const PROMPT = 'A small red fox sitting in a snowy pine forest at dusk, soft watercolor style'
const OK_BODY = {
  created: 1792526869518,
  data: [{ b64_json: 'AAA' }],
  cost: 0.005,
  paymentSource: 'USD',
  remainingBalance: 8.56,
  requestId: 'media-image:abc',
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const model = (id = 'minimax-image-01') =>
  createNanoGPTImage({ apiKey: 'k', baseURL: BASE_URL, fetch: fetchMock }).imageModel(id)

function sent() {
  const [url, init] = fetchMock.mock.calls[0]
  return {
    url,
    headers: new Headers(init?.headers),
    body: JSON.parse(init?.body as string) as Record<string, unknown>,
    signal: init?.signal,
  }
}

async function rejection(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
}

const callOptions = (over: Partial<ImageModelV4CallOptions> = {}): ImageModelV4CallOptions => ({
  prompt: 'p',
  n: 1,
  size: undefined,
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: {},
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async () => json(OK_BODY))
})

describe('request', () => {
  it('posts a text-only prompt to /images', async () => {
    const result = await generateSdkImage({ model: model(), prompt: PROMPT })

    const { url, headers, body } = sent()
    expect(url).toBe(`${BASE_URL}/images`)
    expect(headers.get('Authorization')).toBe('Bearer k')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(body).toEqual({ model: 'minimax-image-01', prompt: PROMPT, n: 1 })
    expect(result).toEqual({ base64: 'AAA' })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const trailing = createNanoGPTImage({
      apiKey: 'k',
      baseURL: `${BASE_URL}/`,
      fetch: fetchMock,
    })
    await generateSdkImage({ model: trailing.imageModel('m'), prompt: 'p' })
    expect(sent().url).toBe(`${BASE_URL}/images`)
  })

  it('sends references as input_references data URLs with their sniffed type', async () => {
    await generateSdkImage({
      model: model(),
      prompt: 'Make it nighttime with falling snow',
      referenceImages: [JPEG, PNG],
    })

    expect(sent().body).toEqual({
      model: 'minimax-image-01',
      prompt: 'Make it nighttime with falling snow',
      n: 1,
      input_references: [`data:image/jpeg;base64,${JPEG}`, `data:image/png;base64,${PNG}`],
    })
  })

  it('sends the aspect ratio and the provider options', async () => {
    await generateSdkImage({
      model: model('qwen-image-2.1-turbo'),
      prompt: 'p',
      aspectRatio: '16:9',
      providerOptions: { nanogpt: { resolution: '1k' } },
    })

    expect(sent().body).toEqual({
      model: 'qwen-image-2.1-turbo',
      prompt: 'p',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '1k',
    })
  })

  it('does not let provider options override the fixed fields', async () => {
    await model().doGenerate(
      callOptions({
        prompt: 'real',
        providerOptions: { nanogpt: { model: 'other', prompt: 'other', n: 9, resolution: '2k' } },
      }),
    )
    expect(sent().body).toEqual({
      model: 'minimax-image-01',
      prompt: 'real',
      n: 1,
      resolution: '2k',
    })
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    await model().doGenerate(callOptions({ abortSignal: controller.signal }))
    expect(sent().signal).toBe(controller.signal)
  })

  it('drops a size with a warning, since resolution tokens are not WxH', async () => {
    const result = await model().doGenerate(callOptions({ size: '1024x1024' }))
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'size' }),
    ])
    expect(sent().body).not.toHaveProperty('size')
  })

  it('drops a mask with a warning', async () => {
    const result = await model().doGenerate(
      callOptions({ mask: { type: 'file', mediaType: 'image/png', data: PNG } }),
    )
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'mask' }),
    ])
  })

  it('rejects a reference given as a URL, so the public-address check is not bypassed', async () => {
    await expect(
      model().doGenerate(
        callOptions({ files: [{ type: 'url', url: 'https://example.test/a.png' }] }),
      ),
    ).rejects.toThrow('base64')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('response', () => {
  it('returns b64_json as it came', async () => {
    const result = await model().doGenerate(callOptions())
    expect(result.images).toEqual(['AAA'])
    expect(result.response.modelId).toBe('minimax-image-01')
  })

  it('downloads a url item through the injected fetch without sending the key', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/images')
        ? json({ data: [{ url: 'https://cdn.test/a.png' }] })
        : new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }),
    )

    const signal = new AbortController().signal
    const result = await model().doGenerate(callOptions({ abortSignal: signal }))

    expect(result.images).toEqual([PNG_BYTES_BASE64])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://cdn.test/a.png')
    expect(init?.signal).toBe(signal)
    expect(init?.redirect).toBe('manual')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
  })

  it('refuses to download a url that is not a public host', async () => {
    fetchMock.mockImplementation(async () => json({ data: [{ url: 'http://127.0.0.1/a.png' }] }))

    const error = await rejection(model().doGenerate(callOptions()))
    expect(error).toBeInstanceOf(Error)
    expect(APICallError.isInstance(error)).toBe(false)
    expect((error as Error).message).toContain('public host')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not follow a redirect from the download url', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/images')
        ? json({ data: [{ url: 'https://cdn.test/a.png' }] })
        : new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/a.png' } }),
    )

    const error = await rejection(model().doGenerate(callOptions()))
    expect(error).toBeInstanceOf(Error)
    expect(APICallError.isInstance(error)).toBe(false)
    expect((error as Error).message).toContain('302')
  })

  it('prefers b64_json when an item has both, and handles a mix', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/images')
        ? json({
            data: [
              { b64_json: 'A', url: 'https://cdn.test/a.png' },
              { url: 'https://cdn.test/b.png' },
            ],
          })
        : new Response(PNG_BYTES),
    )

    const result = await model().doGenerate(callOptions({ n: 2 }))
    expect(result.images).toEqual(['A', PNG_BYTES_BASE64])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails on a download that is not 2xx, without an APICallError the 429 retry would act on', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/images')
        ? json({ data: [{ url: 'https://cdn.test/a.png' }] })
        : new Response('slow down', { status: 429 }),
    )

    const error = await rejection(model().doGenerate(callOptions()))
    expect(error).toBeInstanceOf(Error)
    expect(APICallError.isInstance(error)).toBe(false)
    expect((error as Error).message).toContain('429')
  })

  it.each([
    ['no items', { data: [] }],
    ['no data', {}],
    ['an item with neither field', { data: [{ revised_prompt: 'x' }] }],
  ])('throws NoImageGeneratedError for %s', async (_, body) => {
    fetchMock.mockImplementation(async () => json(body))
    const error = await generateSdkImage({ model: model(), prompt: 'p' }).catch((e: unknown) => e)
    expect(NoImageGeneratedError.isInstance(error)).toBe(true)
  })

  it.each([
    ['not JSON', () => new Response('<html>gateway</html>')],
    ['a JSON array', () => json([1, 2])],
  ])('rejects a 200 that is %s', async (_, response) => {
    fetchMock.mockImplementation(async () => response())
    const error = await rejection(model().doGenerate(callOptions()))
    expect(InvalidResponseDataError.isInstance(error)).toBe(true)
  })
})

describe('errors', () => {
  const failure = async (response: Response) => {
    fetchMock.mockImplementation(async () => response.clone())
    const error = await rejection(model().doGenerate(callOptions()))
    expect(APICallError.isInstance(error)).toBe(true)
    return error as APICallError
  }

  it('reads the message of a nested error object', async () => {
    const error = await failure(
      json(
        {
          error: {
            message: 'Invalid session',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        401,
      ),
    )
    expect(error.message).toBe('Invalid session')
    expect(error.statusCode).toBe(401)
  })

  it('reads the message of a nested error object that repeats its code', async () => {
    const error = await failure(
      json(
        {
          error: {
            message: 'Invalid image model specified.',
            type: 'invalid_request_error',
            code: 'invalid_model',
          },
          code: 'invalid_model',
        },
        400,
      ),
    )
    expect(error.message).toBe('Invalid image model specified.')
  })

  it('reads the message of a string error', async () => {
    const message =
      'Unable to safely load the image. Upload a supported image or check the image URL.'
    const error = await failure(
      json({ error: message, code: 'INVALID_IMAGE_INPUT', type: 'INVALID_IMAGE_INPUT' }, 400),
    )
    expect(error.message).toBe(message)
  })

  it('falls back to a top-level message, then to the body text', async () => {
    expect((await failure(json({ message: 'Slow down' }, 429))).message).toBe('Slow down')
    expect((await failure(new Response('Bad gateway', { status: 502 }))).message).toBe(
      'Bad gateway',
    )
    expect((await failure(new Response('', { status: 503 }))).message).toBe('HTTP 503')
  })

  it('keeps the response headers and body, and is not retryable by itself', async () => {
    const error = await failure(json({ error: 'busy' }, 429, { 'Retry-After': '7' }))
    expect(error.responseHeaders).toMatchObject({ 'retry-after': '7' })
    expect(error.responseBody).toBe('{"error":"busy"}')
    expect(error.isRetryable).toBe(false)
  })

  it('does not put reference data in the recorded request', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'no' }, 400))
    const error = await rejection(
      model().doGenerate(
        callOptions({ files: [{ type: 'file', mediaType: 'image/png', data: PNG }] }),
      ),
    )
    expect(JSON.stringify((error as APICallError).requestBodyValues)).not.toContain(PNG)
  })
})

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries a 429 once after Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: 'busy' }, 429, { 'Retry-After': '1' }))
      .mockResolvedValue(json(OK_BODY))

    const result = generateSdkImage({ model: model(), prompt: 'p' })
    await vi.advanceTimersByTimeAsync(11_000)

    await expect(result).resolves.toEqual({ base64: 'AAA' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 500, which may already have been billed', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'boom' }, 500))

    await expect(generateSdkImage({ model: model(), prompt: 'p' })).rejects.toMatchObject({
      statusCode: 500,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
