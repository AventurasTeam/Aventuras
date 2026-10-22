import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

// The real store is a rune module, which this suite cannot import.
const { debug } = vi.hoisted(() => ({
  debug: { isActive: false, addDebugRequest: vi.fn(() => 'dbg'), addDebugResponse: vi.fn() },
}))
vi.mock('#lib/stores/debug.svelte.ts', () => ({ debug }))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { isAbortError } from '#lib/services/activity/describeError.ts'
import { RequestTimeoutError } from '#lib/utils/error.ts'
import { describeRequestBody, logStreamResponse, scrubBase64 } from './debugLog'
import { createPollSdkFetch, createSdkFetch } from './sdkFetch'

const mockFetch = vi.mocked(tauriHttpFetch)
const API_URL = 'https://api.test/v1/images'

const sdkFetch = (timeoutMs = 60_000) =>
  createSdkFetch({ serviceId: 'google-image', timeoutMs, what: 'Image generation' })

/** Like the plugin: stays pending, then rejects with a bare string when its signal aborts. */
function pendingUntilAborted(_url: unknown, init?: { signal?: AbortSignal | null }) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject('Request canceled'))
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mockFetch.mockReset()
  debug.isActive = false
  debug.addDebugRequest.mockClear()
  debug.addDebugResponse.mockClear()
})

describe('request bodies', () => {
  beforeEach(() => {
    mockFetch.mockImplementation(async () => new Response('{}', { status: 200 }))
  })

  it('hands a FormData to the plugin whole, for it to encode', async () => {
    const form = new FormData()
    form.append('prompt', 'a castle')

    await sdkFetch()(API_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: form,
    })

    const init = mockFetch.mock.calls[0][1]!
    const headers = new Headers(init.headers)
    expect(init.body).toBe(form)
    expect(headers.has('content-type')).toBe(false)
    expect(headers.get('authorization')).toBe('Bearer key')
    expect(headers.get('origin')).toBe('')
  })

  it('drops a content-type the caller set on a FormData request', async () => {
    await sdkFetch()(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new FormData(),
    })

    const headers = new Headers(mockFetch.mock.calls[0][1]!.headers)
    expect(headers.has('content-type')).toBe(false)
  })

  it('keeps the content-type of a string body', async () => {
    await sdkFetch()(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const headers = new Headers(mockFetch.mock.calls[0][1]!.headers)
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('sends a string body byte for byte, JSON or not', async () => {
    await sdkFetch()(API_URL, { method: 'POST', body: 'not json {' })

    expect(mockFetch.mock.calls[0][1]!.body).toBe('not json {')
  })
})

describe('redirects', () => {
  beforeEach(() => {
    mockFetch.mockImplementation(async () => new Response('{}', { status: 200 }))
  })

  it('has the plugin return a 3xx instead of following it when the caller asks for manual', async () => {
    await sdkFetch()(API_URL, { redirect: 'manual' })

    expect(mockFetch.mock.calls[0][1]).toMatchObject({ maxRedirections: 0 })
  })

  it('leaves the plugin to follow redirects otherwise', async () => {
    await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('maxRedirections')
  })
})

describe('responses', () => {
  it('returns an error status instead of throwing, body intact', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"slow down"}', { status: 429 }))

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(response.status).toBe(429)
    expect(await response.text()).toBe('{"error":"slow down"}')
  })

  it('returns a JSON success body unchanged', async () => {
    const body = { candidates: [{ index: 0 }] }
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(await response.json()).toEqual(body)
  })
})

describe('abort handling', () => {
  beforeEach(() => {
    mockFetch.mockImplementation(pendingUntilAborted)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a caller abort as an AbortError', async () => {
    const caller = new AbortController()
    const request = sdkFetch()(API_URL, { method: 'POST', signal: caller.signal }).catch(
      (e: unknown) => e,
    )

    caller.abort()

    const error = await request
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(isAbortError(error)).toBe(true)
  })

  it('rejects a timeout as a RequestTimeoutError, not an abort', async () => {
    vi.useFakeTimers()
    const request = sdkFetch(5_000)(API_URL, { method: 'POST' }).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(5_000)

    const error = await request
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: 'Image generation timed out after 5s' })
    expect(isAbortError(error)).toBe(false)
  })
})

describe('debug logging', () => {
  const geminiImage = {
    candidates: [
      {
        content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'A'.repeat(2048) } }] },
        safetyRatings: [{ category: 'X' }],
      },
    ],
  }

  beforeEach(() => {
    debug.isActive = true
  })

  it('redacts the key and lists FormData field names', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const form = new FormData()
    form.append('prompt', 'a castle')
    form.append('image', new Blob(['x']), 'a.png')

    await sdkFetch()(API_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-1234567890abcdef' },
      body: form,
    })

    expect(debug.addDebugRequest).toHaveBeenCalledWith(
      'google-image',
      expect.objectContaining({
        headers: { Authorization: 'Bear...cdef' },
        body: { formData: ['prompt', 'image'] },
      }),
      undefined,
    )
  })

  it('redacts the Gemini key header', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await sdkFetch()(API_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': 'AIzaSyD1234567890abcdefghij' },
      body: '{}',
    })

    expect(debug.addDebugRequest).toHaveBeenCalledWith(
      'google-image',
      expect.objectContaining({ headers: { 'x-goog-api-key': 'AIza...ghij' } }),
      undefined,
    )
  })

  it('does not describe the request when debug logging is off', async () => {
    debug.isActive = false
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(debug.addDebugRequest).not.toHaveBeenCalled()
  })

  it('keeps a request out of the debug log when log is false', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const quiet = createSdkFetch({ serviceId: 'google-image', timeoutMs: 60_000, log: false })
    await quiet(API_URL)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(debug.addDebugRequest).not.toHaveBeenCalled()
  })

  it('scrubs inline image data from a JSON response and keeps the rest', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(geminiImage), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })
    await flush()

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'google-image',
      {
        body: {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: '[base64, 2048 chars]' } }],
              },
              safetyRatings: [{ category: 'X' }],
            },
          ],
        },
        providerMetadata: { safetyRatings: [{ category: 'X' }] },
      },
      expect.any(Number),
    )
    expect(await response.json()).toEqual(geminiImage)
  })

  it('scrubs base64 out of a request body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const body = { contents: [{ parts: [{ inlineData: { data: 'B'.repeat(2048) } }] }] }

    await sdkFetch()(API_URL, { method: 'POST', body: JSON.stringify(body) })

    expect(debug.addDebugRequest).toHaveBeenCalledWith(
      'google-image',
      expect.objectContaining({
        body: { contents: [{ parts: [{ inlineData: { data: '[base64, 2048 chars]' } }] }] },
      }),
      undefined,
    )
  })

  it('logs a binary response by type and size, leaving its body unread', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(4), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
      }),
    )

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'google-image',
      { contentType: 'audio/mpeg', size: 4 },
      expect.any(Number),
    )
    expect(response.bodyUsed).toBe(false)
  })

  it('logs any octet-stream type as binary too', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(4), {
        status: 200,
        headers: { 'content-type': 'binary/octet-stream', 'content-length': '4' },
      }),
    )

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'google-image',
      { contentType: 'binary/octet-stream', size: 4 },
      expect.any(Number),
    )
    expect(response.bodyUsed).toBe(false)
  })

  it('logs an error response and still returns it', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"bad"}', { status: 400 }))

    const response = await sdkFetch()(API_URL, { method: 'POST', body: '{}' })
    await flush()

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'google-image',
      expect.objectContaining({ status: 400, error: { error: 'bad' } }),
      expect.any(Number),
      '{"error":"bad"}',
    )
    expect(response.status).toBe(400)
  })
})

describe('scrubBase64', () => {
  it('replaces long base64 and data URIs', () => {
    expect(scrubBase64('A'.repeat(1024))).toBe('[base64, 1024 chars]')
    expect(scrubBase64('data:image/png;base64,' + 'A'.repeat(1024))).toMatch(
      /^\[base64, \d+ chars\]$/,
    )
  })

  it('leaves short strings, long prose and non-strings alone', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(40)
    expect(scrubBase64('iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
    expect(scrubBase64(prose)).toBe(prose)
    expect(scrubBase64(7)).toBe(7)
    expect(scrubBase64(null)).toBe(null)
  })
})

describe('describeRequestBody', () => {
  it('scrubs nested strings and keeps other values', () => {
    const body = JSON.stringify({ n: 1, ok: true, none: null, list: [{ data: 'A'.repeat(1024) }] })
    expect(describeRequestBody(body)).toEqual({
      n: 1,
      ok: true,
      none: null,
      list: [{ data: '[base64, 1024 chars]' }],
    })
  })

  it('falls back to a raw excerpt for a body that is not JSON', () => {
    expect(describeRequestBody('not json')).toEqual({ raw: 'not json' })
  })
})

describe('logStreamResponse', () => {
  const sse = (...events: unknown[]) =>
    new Response(
      events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}`).join('\n\n'),
    )

  it('aggregates tool-call deltas into one choice', async () => {
    const response = sse(
      {
        id: 'c1',
        model: 'm',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'lookup', arguments: '{"a":' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
      '[DONE]',
    )

    await logStreamResponse(response, 'dbg', 'test', 0)

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'test',
      {
        body: {
          _note: 'Aggregated from stream',
          id: 'c1',
          model: 'm',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"a":1}', parsed_arguments: { a: 1 } },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        providerMetadata: undefined,
        stream: true,
      },
      0,
    )
  })

  it('keeps safetyRatings from an earlier chunk when a later one has only promptFeedback', async () => {
    const response = sse(
      { candidates: [{ safetyRatings: [{ category: 'X' }] }] },
      { promptFeedback: { blockReason: 'SAFETY' } },
    )

    await logStreamResponse(response, 'dbg', 'test', 0)

    expect(debug.addDebugResponse).toHaveBeenCalledWith(
      'dbg',
      'test',
      expect.objectContaining({
        providerMetadata: {
          safetyRatings: [{ category: 'X' }],
          promptFeedback: { blockReason: 'SAFETY' },
        },
      }),
      0,
    )
  })
})

describe('createPollSdkFetch', () => {
  const POLL_URL = 'http://localhost:8188/api/jobs/abc'

  const poll = () =>
    createPollSdkFetch({
      serviceId: 'comfyui-image',
      timeoutMs: 60_000,
      what: 'Image generation',
    })

  const jsonReply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const lastResponseData = () => debug.addDebugResponse.mock.calls.at(-1)?.[2]

  beforeEach(() => {
    debug.isActive = true
  })

  it('opens one entry however many requests there are', async () => {
    mockFetch.mockImplementation(async () => jsonReply({ status: 'in_progress' }))
    const fetch = poll()

    await fetch(`${POLL_URL}1`)
    await fetch(`${POLL_URL}2`)
    await fetch(`${POLL_URL}3`)
    await flush()

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(debug.addDebugRequest).toHaveBeenCalledTimes(1)
    expect(debug.addDebugRequest).toHaveBeenCalledWith(
      'comfyui-image',
      expect.objectContaining({ url: `${POLL_URL}1`, method: 'GET' }),
    )
    expect(debug.addDebugResponse).toHaveBeenCalledTimes(3)
    expect(debug.addDebugResponse.mock.calls.every(([id]) => id === 'dbg')).toBe(true)
  })

  it('keeps the count and the latest request and response in the entry', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonReply({ status: 'pending' }))
      .mockResolvedValueOnce(jsonReply({ status: 'in_progress' }))
      .mockResolvedValueOnce(jsonReply({ status: 'completed', outputs: {} }))
    const fetch = poll()

    await fetch(`${POLL_URL}1`)
    await flush()
    expect(lastResponseData()).toEqual({
      requests: 1,
      last: { method: 'GET', url: `${POLL_URL}1`, status: 200, body: { status: 'pending' } },
    })

    await fetch(`${POLL_URL}2`)
    await fetch(`${POLL_URL}3`, { method: 'POST' })
    await flush()

    expect(debug.addDebugResponse).toHaveBeenLastCalledWith(
      'dbg',
      'comfyui-image',
      {
        requests: 3,
        last: {
          method: 'POST',
          url: `${POLL_URL}3`,
          status: 200,
          body: { status: 'completed', outputs: {} },
        },
      },
      expect.any(Number),
    )
  })

  it('lists the requests that threw or failed, and shows the last one on its own', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonReply({ status: 'completed' }))
    const fetch = poll()

    await fetch(POLL_URL).catch(() => {})
    await flush()
    expect(lastResponseData()).toEqual({
      requests: 1,
      last: { method: 'GET', url: POLL_URL, error: 'socket closed' },
      failures: [{ method: 'GET', url: POLL_URL, error: 'socket closed' }],
    })

    await fetch(POLL_URL)
    await fetch(POLL_URL)
    await flush()

    expect(lastResponseData()).toEqual({
      requests: 3,
      last: { method: 'GET', url: POLL_URL, status: 200, body: { status: 'completed' } },
      failures: [
        { method: 'GET', url: POLL_URL, error: 'socket closed' },
        { method: 'GET', url: POLL_URL, status: 503, body: 'busy' },
      ],
    })
  })

  it('keeps only the most recent failures', async () => {
    mockFetch.mockImplementation(async () => new Response('busy', { status: 503 }))
    const fetch = poll()

    for (let i = 0; i < 25; i++) await fetch(`${POLL_URL}${i}`)
    await flush()

    const data = lastResponseData() as { requests: number; failures: { url: string }[] }
    expect(data.requests).toBe(25)
    expect(data.failures).toHaveLength(20)
    expect(data.failures[0].url).toBe(`${POLL_URL}5`)
    expect(data.failures.at(-1)?.url).toBe(`${POLL_URL}24`)
  })

  it('still returns a response whose body the caller reads', async () => {
    mockFetch.mockResolvedValueOnce(jsonReply({ status: 'completed' }))

    const response = await poll()(POLL_URL)

    expect(await response.json()).toEqual({ status: 'completed' })
    await flush()
    expect(lastResponseData()).toMatchObject({ requests: 1 })
  })

  it('records nothing while debug logging is off', async () => {
    debug.isActive = false
    mockFetch.mockResolvedValue(jsonReply({ status: 'completed' }))

    await poll()(POLL_URL)
    await flush()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(debug.addDebugRequest).not.toHaveBeenCalled()
    expect(debug.addDebugResponse).not.toHaveBeenCalled()
  })

  it('opens the entry when debug logging turns on partway through', async () => {
    debug.isActive = false
    mockFetch.mockImplementation(async () => jsonReply({ status: 'in_progress' }))
    const fetch = poll()

    await fetch(POLL_URL)
    debug.isActive = true
    await fetch(POLL_URL)
    await fetch(POLL_URL)
    await flush()

    expect(debug.addDebugRequest).toHaveBeenCalledTimes(1)
    expect(lastResponseData()).toMatchObject({ requests: 2 })
  })
})
