import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { isAbortError } from '#lib/services/activity/describeError.ts'
import { debugLog } from '#lib/stores/debugLog.ts'
import { RequestTimeoutError } from '#lib/utils/error.ts'
import { firstReadError } from '#lib/utils/idleTimeout.testing.ts'
import { createTimeoutFetch } from './fetch'

const mockFetch = vi.mocked(tauriHttpFetch)

/** Like the plugin: stays pending, then rejects with a bare string when its signal aborts. */
function pendingUntilAborted(_url: unknown, init?: { signal?: AbortSignal | null }) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject('Request canceled'))
  })
}

describe('createTimeoutFetch abort handling', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a caller abort while pending as an AbortError', async () => {
    mockFetch.mockImplementation(pendingUntilAborted)
    const caller = new AbortController()
    const request = createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    })

    caller.abort()

    const error = await request.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(isAbortError(error)).toBe(true)
  })

  it('rejects as an AbortError when the plugin throws a plain Error after the caller aborted', async () => {
    const caller = new AbortController()
    caller.abort()
    mockFetch.mockRejectedValue(new Error('Request cancelled'))

    const error = await createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    }).catch((e: unknown) => e)

    expect(isAbortError(error)).toBe(true)
  })

  it('rejects a timeout as a RequestTimeoutError, not an abort', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(pendingUntilAborted)
    const caller = new AbortController()
    const request = createTimeoutFetch(5_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    }).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(5_000)

    const error = await request
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: 'Request timed out after 5s' })
    expect(isAbortError(error)).toBe(false)
  })

  it('passes an unrelated rejection through unchanged', async () => {
    const failure = new Error('connection refused')
    mockFetch.mockRejectedValue(failure)

    await expect(
      createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failure)
  })
})

/** A response whose body the test drives; the plugin errors it with a bare string on abort. */
function sseResponse(signal?: AbortSignal | null, contentType = 'text/event-stream') {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c
      signal?.addEventListener('abort', () => c.error('Request cancelled'))
    },
  })
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  })
  return { response, controller }
}

const encode = (text: string) => new TextEncoder().encode(text)

describe('createTimeoutFetch body handling', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([[200], [502]])(
    'errors a stalled body (status %i) with a RequestTimeoutError and aborts the plugin request',
    async (status) => {
      vi.useFakeTimers()
      let pluginSignal: AbortSignal | null | undefined
      mockFetch.mockImplementation(async (_url, init) => {
        pluginSignal = init?.signal
        const { controller, response } = sseResponse(init?.signal)
        controller.enqueue(new TextEncoder().encode('data: {"partial":'))
        return new Response(response.body, { status, headers: response.headers })
      })

      const response = await createTimeoutFetch(5_000, 'test')('https://api.test/v1', {
        signal: new AbortController().signal,
      })
      const read = response.text().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(5_000)

      const error = await read
      expect(error).toBeInstanceOf(RequestTimeoutError)
      expect(isAbortError(error)).toBe(false)
      expect(pluginSignal?.aborted).toBe(true)
    },
  )

  it('times out a JSON body that stalls, as a RequestTimeoutError', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(async (_url, init) => {
      const { controller, response } = sseResponse(init?.signal, 'application/json')
      controller.enqueue(encode('{"partial":'))
      return response
    })

    const request = createTimeoutFetch(
      5_000,
      'test',
    )('https://api.test/v1').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await request).toBeInstanceOf(RequestTimeoutError)
  })

  it('does not time out a JSON body that keeps arriving, however long it takes in all', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    mockFetch.mockImplementation(async (_url, init) => {
      const reply = sseResponse(init?.signal, 'application/json')
      controller = reply.controller
      controller.enqueue(encode('{"a":'))
      return reply.response
    })

    const request = createTimeoutFetch(5_000, 'test')('https://api.test/v1')
    await vi.advanceTimersByTimeAsync(4_000)
    controller.enqueue(encode('1,'))
    await vi.advanceTimersByTimeAsync(4_000)
    controller.enqueue(encode('"b":2}'))
    controller.close()

    const response = await request
    expect(await response.json()).toEqual({
      a: 1,
      b: 2,
      usage: { input_tokens: 0, output_tokens: 0 },
    })
  })

  it('rejects a caller abort mid-body as an AbortError', async () => {
    mockFetch.mockImplementation(async (_url, init) => sseResponse(init?.signal).response)
    const caller = new AbortController()

    const response = await createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    })
    const read = firstReadError(response)
    caller.abort()

    expect(isAbortError(await read)).toBe(true)
  })

  it('aborts the plugin request at once for an already-aborted caller signal', async () => {
    const caller = new AbortController()
    caller.abort()
    let pluginSignal: AbortSignal | null | undefined
    mockFetch.mockImplementation(async (_url, init) => {
      pluginSignal = init?.signal
      throw new Error('Request cancelled')
    })

    await createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    }).catch(() => {})

    expect(pluginSignal?.aborted).toBe(true)
  })

  it('removes the caller listener once a JSON response is buffered', async () => {
    mockFetch.mockResolvedValue(
      new Response('{"id":"x"}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')

    await createTimeoutFetch(60_000, 'test')('https://api.test/v1', { signal: caller.signal })

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('removes the caller listener when a stream finishes', async () => {
    const { response, controller } = sseResponse()
    mockFetch.mockResolvedValue(response)
    const caller = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')

    const result = await createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      signal: caller.signal,
    })
    expect(remove).not.toHaveBeenCalled()
    controller.close()
    await result.text()

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('does not leak a listener when the request body is not JSON', async () => {
    const caller = new AbortController()
    const add = vi.spyOn(caller.signal, 'addEventListener')

    await expect(
      createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
        method: 'POST',
        body: 'not json',
        signal: caller.signal,
      }),
    ).rejects.toThrow('not valid JSON')

    expect(add).not.toHaveBeenCalled()
  })
})

describe('createTimeoutFetch request headers', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('sends an empty Origin alongside the caller headers', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )

    await createTimeoutFetch(60_000, 'test')('https://api.test/v1', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: '{}',
    })

    const headers = new Headers(mockFetch.mock.calls[0][1]?.headers)
    expect(headers.get('origin')).toBe('')
    expect(headers.get('authorization')).toBe('Bearer key')
  })
})

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })

describe('createTimeoutFetch response patching', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('adds zero usage to a response without one', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'x' }))

    const response = await createTimeoutFetch(60_000, 'test')('https://api.test/v1')

    expect(await response.json()).toEqual({ id: 'x', usage: { input_tokens: 0, output_tokens: 0 } })
  })

  it('maps prompt and completion tokens onto input and output tokens', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }),
    )

    const response = await createTimeoutFetch(60_000, 'test')('https://api.test/v1')

    expect(await response.json()).toEqual({
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
        input_tokens: 7,
        output_tokens: 3,
      },
    })
  })

  it('keeps existing input and output tokens', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ usage: { input_tokens: 1, output_tokens: 2, prompt_tokens: 9 } }),
    )

    const response = await createTimeoutFetch(60_000, 'test')('https://api.test/v1')

    expect(await response.json()).toEqual({
      usage: { input_tokens: 1, output_tokens: 2, prompt_tokens: 9 },
    })
  })
})

describe('createTimeoutFetch manual body', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(jsonResponse({}))
  })

  const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1]?.body as string)

  it('merges manual keys into the request body', async () => {
    await createTimeoutFetch(
      60_000,
      'test',
      '{"temperature":0.2}',
    )('https://api.test/v1', {
      method: 'POST',
      body: '{"model":"m"}',
    })

    expect(sentBody()).toEqual({ model: 'm', temperature: 0.2 })
  })

  it('does not let the manual body override reserved keys', async () => {
    const messages = [{ role: 'user', content: 'hi' }]
    await createTimeoutFetch(
      60_000,
      'test',
      '{"messages":[],"model":"other","stream":true,"top_p":0.5}',
    )('https://api.test/v1', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', messages }),
    })

    expect(sentBody()).toEqual({ model: 'm', messages, top_p: 0.5 })
  })

  it('sends no body when there is neither a request nor a manual body', async () => {
    await createTimeoutFetch(60_000, 'test')('https://api.test/v1')

    expect(mockFetch.mock.calls[0][1]?.body).toBeUndefined()
  })
})

describe('createTimeoutFetch debug log', () => {
  const entries = (type: 'request' | 'response') =>
    debugLog.snapshot().filter((e) => e.type === type)

  beforeEach(() => {
    mockFetch.mockReset()
    debugLog.reset()
    debugLog.active = true
  })

  afterEach(() => {
    debugLog.active = false
    debugLog.reset()
    vi.useRealTimers()
  })

  it('logs the status and the error when a JSON body fails mid-read', async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      const { controller, response } = sseResponse(init?.signal, 'application/json')
      controller.enqueue(encode('{"partial":'))
      controller.error(new Error('connection lost'))
      return response
    })

    await expect(createTimeoutFetch(60_000, 'test')('https://api.test/v1')).rejects.toThrow(
      'connection lost',
    )

    await vi.waitFor(() => expect(entries('response')).toHaveLength(1))
    expect(entries('response')[0].data).toEqual({ status: 200, error: 'connection lost' })
  })

  it('logs the status and the error when a stream stalls', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(async (_url, init) => {
      const { controller, response } = sseResponse(init?.signal)
      controller.enqueue(encode('data: {"partial":'))
      return response
    })

    const response = await createTimeoutFetch(5_000, 'test')('https://api.test/v1')
    const read = response.text().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    await read

    await vi.waitFor(() => expect(entries('response')).toHaveLength(1))
    expect(entries('response')[0].data).toEqual({
      status: 200,
      error: 'Request timed out after 5s',
    })
  })

  it('leaves the caller the whole stream while logging it', async () => {
    const { controller, response } = sseResponse()
    mockFetch.mockResolvedValue(response)
    const event = 'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'

    const result = await createTimeoutFetch(60_000, 'test')('https://api.test/v1')
    controller.enqueue(encode(event))
    controller.close()

    expect(await result.text()).toBe(event)
    await vi.waitFor(() => expect(entries('response')).toHaveLength(1))
    expect(entries('response')[0].data).toMatchObject({ status: 200, stream: true })
  })

  it('logs the JSON response unpatched, scrubbed, with its status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'x', image: 'A'.repeat(2048) }))

    const response = await createTimeoutFetch(60_000, 'test')('https://api.test/v1')
    expect(await response.json()).toEqual({
      id: 'x',
      image: 'A'.repeat(2048),
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    await vi.waitFor(() => expect(entries('response')).toHaveLength(1))
    expect(entries('response')[0].data).toEqual({
      status: 200,
      body: { id: 'x', image: '[base64, 2048 chars]' },
      providerMetadata: undefined,
    })
  })

  it('shows the body it sends, manual keys included, with the key redacted', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}))

    await createTimeoutFetch(
      60_000,
      'test',
      '{"top_k":5}',
    )('https://api.test/v1', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-1234567890' },
      body: JSON.stringify({ model: 'm' }),
    })

    expect(entries('request')[0].data).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bear...7890' },
      body: { model: 'm', top_k: 5 },
    })
  })

  it('attaches to the debug id it is given', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}))

    await createTimeoutFetch(60_000, 'test', '', 'turn-1')('https://api.test/v1')

    expect(entries('request')[0].id).toBe('turn-1')
  })

  it('writes an error entry when the request times out', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(pendingUntilAborted)

    const request = createTimeoutFetch(
      5_000,
      'test',
    )('https://api.test/v1').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(await request).toBeInstanceOf(RequestTimeoutError)
    expect(entries('response')[0].data).toEqual({ error: 'Request timed out after 5s' })
    vi.useRealTimers()
  })

  it('writes nothing while debug mode is off', async () => {
    debugLog.active = false
    mockFetch.mockResolvedValue(jsonResponse({}))

    await createTimeoutFetch(60_000, 'test')('https://api.test/v1')

    expect(debugLog.snapshot()).toEqual([])
  })
})
