import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError, InvalidResponseDataError, NoImageGeneratedError } from 'ai'
import type { ImageModelV4CallOptions } from '@ai-sdk/provider'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(),
}))

import { generateSdkImage } from './sdkImage'
import { createA1111Image } from './a1111Image'

const BASE_URL = 'http://localhost:7860'
const PNG = 'iVBORw0KGgo='

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const OK_BODY = { images: ['AAA'], parameters: {}, info: '{}' }

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const model = (id = 'v1-5-pruned-emaonly.safetensors [6ce0161689]', apiKey?: string) =>
  createA1111Image({ baseURL: BASE_URL, apiKey, fetch: fetchMock }).imageModel(id)

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
  size: '512x512',
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
  it('posts the prompt, size, checkpoint and provider options to /sdapi/v1/txt2img', async () => {
    const result = await generateSdkImage({
      model: model('dreamshaper_8.safetensors'),
      prompt: 'a castle',
      size: '1536x864',
      providerOptions: {
        a1111: {
          negative_prompt: 'blurry',
          steps: 30,
          cfg_scale: 6.5,
          sampler_name: 'DPM++ 2M',
          scheduler: 'Karras',
        },
      },
    })

    const { url, headers, body } = sent()
    expect(url).toBe(`${BASE_URL}/sdapi/v1/txt2img`)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(body).toEqual({
      prompt: 'a castle',
      negative_prompt: 'blurry',
      width: 1536,
      height: 864,
      steps: 30,
      cfg_scale: 6.5,
      sampler_name: 'DPM++ 2M',
      scheduler: 'Karras',
      batch_size: 1,
      n_iter: 1,
      seed: -1,
      override_settings: { sd_model_checkpoint: 'dreamshaper_8.safetensors' },
      override_settings_restore_afterwards: true,
    })
    expect(result).toEqual({ base64: 'AAA' })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const trailing = createA1111Image({ baseURL: `${BASE_URL}/`, fetch: fetchMock })
    await generateSdkImage({ model: trailing.imageModel('m'), prompt: 'p', size: '512x512' })
    expect(sent().url).toBe(`${BASE_URL}/sdapi/v1/txt2img`)
  })

  it('leaves the loaded checkpoint alone when no model is set', async () => {
    await model('').doGenerate(callOptions())
    const { body } = sent()
    expect(body).not.toHaveProperty('override_settings')
    expect(body).not.toHaveProperty('override_settings_restore_afterwards')
  })

  it('sends a bearer token only when a key is set', async () => {
    await model('m', 'secret').doGenerate(callOptions())
    expect(sent().headers.get('Authorization')).toBe('Bearer secret')

    fetchMock.mockClear()
    await model('m').doGenerate(callOptions())
    expect(sent().headers.has('Authorization')).toBe(false)
  })

  it('sends a seed when one is given', async () => {
    await model().doGenerate(callOptions({ seed: 42 }))
    expect(sent().body.seed).toBe(42)
  })

  it('does not let provider options override the fixed fields', async () => {
    await model('real').doGenerate(
      callOptions({
        prompt: 'real prompt',
        size: '768x512',
        providerOptions: {
          a1111: {
            prompt: 'other',
            width: 1,
            height: 1,
            n_iter: 9,
            batch_size: 9,
            override_settings: { sd_model_checkpoint: 'other' },
            steps: 12,
          },
        },
      }),
    )
    expect(sent().body).toEqual({
      prompt: 'real prompt',
      width: 768,
      height: 512,
      seed: -1,
      batch_size: 1,
      n_iter: 1,
      override_settings: { sd_model_checkpoint: 'real' },
      override_settings_restore_afterwards: true,
      steps: 12,
    })
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    await model().doGenerate(callOptions({ abortSignal: controller.signal }))
    expect(sent().signal).toBe(controller.signal)
  })

  it('needs a WxH size', async () => {
    const error = await rejection(model().doGenerate(callOptions({ size: undefined })))
    expect((error as Error).message).toContain('WxH')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops an aspect ratio and a mask with warnings', async () => {
    const result = await model().doGenerate(
      callOptions({
        aspectRatio: '16:9',
        mask: { type: 'file', mediaType: 'image/png', data: PNG },
      }),
    )
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'aspectRatio' }),
      expect.objectContaining({ type: 'unsupported', feature: 'mask' }),
    ])
  })

  it('sends references as extra_images on the txt2img request', async () => {
    const result = await model().doGenerate(
      callOptions({
        files: [
          { type: 'file', mediaType: 'image/png', data: PNG },
          { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
        ],
      }),
    )
    const { url, body } = sent()
    expect(url).toBe(`${BASE_URL}/sdapi/v1/txt2img`)
    expect(body.extra_images).toEqual([PNG, 'AQID'])
    expect(body).not.toHaveProperty('init_images')
    expect(result.warnings).toEqual([])
  })

  it('leaves extra_images out without references', async () => {
    await model().doGenerate(callOptions({ files: [] }))
    expect(sent().body).not.toHaveProperty('extra_images')
  })

  it('keeps the reference images out of a failure', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'boom' }, 500))
    const error = await rejection(
      model().doGenerate(
        callOptions({ files: [{ type: 'file', mediaType: 'image/png', data: PNG }] }),
      ),
    )
    expect(APICallError.isInstance(error)).toBe(true)
    const body = (error as APICallError).requestBodyValues as Record<string, unknown>
    expect(body.extra_images).toBeUndefined()
  })

  it('refuses a reference given as a URL', async () => {
    const error = await rejection(
      model().doGenerate(
        callOptions({ files: [{ type: 'url', url: 'https://example.com/a.png' }] }),
      ),
    )
    expect((error as Error).message).toContain('base64')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('response', () => {
  it('returns the images as they came', async () => {
    const result = await model('ckpt').doGenerate(callOptions())
    expect(result.images).toEqual(['AAA'])
    expect(result.response.modelId).toBe('ckpt')
  })

  it('throws NoImageGeneratedError for an empty list', async () => {
    fetchMock.mockImplementation(async () => json({ images: [] }))
    const error = await generateSdkImage({ model: model(), prompt: 'p', size: '512x512' }).catch(
      (e: unknown) => e,
    )
    expect(NoImageGeneratedError.isInstance(error)).toBe(true)
  })

  it.each([
    ['not JSON', () => new Response('<html>gateway</html>')],
    ['a JSON array', () => json([1, 2])],
    ['no images field', () => json({ info: '{}' })],
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

  it('reads the detail of a validation error', async () => {
    const error = await failure(
      json(
        {
          detail: [
            { loc: ['body', 'steps'], msg: 'Input should be a valid integer', type: 'int_parsing' },
          ],
        },
        422,
      ),
    )
    expect(error.message).toBe('Input should be a valid integer')
    expect(error.statusCode).toBe(422)
  })

  it('reads the detail of an HTTPException', async () => {
    const error = await failure(
      json(
        {
          error: 'HTTPException',
          detail: 'Sampler not found',
          body: '',
          errors: '400: Sampler not found',
        },
        400,
      ),
    )
    expect(error.message).toBe('Sampler not found')
  })

  it('falls back to errors when detail is empty', async () => {
    const error = await failure(
      json({ error: 'OutOfMemoryError', detail: '', body: '', errors: 'CUDA out of memory' }, 500),
    )
    expect(error.message).toBe('CUDA out of memory')
  })

  it('falls back to the body text, then to the status', async () => {
    expect((await failure(new Response('Bad gateway', { status: 502 }))).message).toBe(
      'Bad gateway',
    )
    expect((await failure(new Response('', { status: 503 }))).message).toBe('HTTP 503')
    expect((await failure(json({ detail: '', errors: '' }, 500))).message).toBe(
      '{"detail":"","errors":""}',
    )
  })

  it('keeps the response body, and is not retryable by itself', async () => {
    const error = await failure(json({ detail: 'busy' }, 429))
    expect(error.responseBody).toBe('{"detail":"busy"}')
    expect(error.isRetryable).toBe(false)
  })

  it('does not retry a 500, which may already have been billed', async () => {
    fetchMock.mockImplementation(async () => json({ detail: 'boom' }, 500))
    await expect(
      generateSdkImage({ model: model(), prompt: 'p', size: '512x512' }),
    ).rejects.toMatchObject({ statusCode: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
