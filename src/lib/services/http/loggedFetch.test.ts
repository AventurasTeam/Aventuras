import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { debugLog } from '#lib/stores/debugLog.ts'
import { RequestTimeoutError } from '#lib/utils/error.ts'
import { loggedFetch } from './loggedFetch'

const mockFetch = vi.mocked(tauriHttpFetch)
const API_URL = 'https://api.test/v1'

const entries = (type: 'request' | 'response') => debugLog.snapshot().filter((e) => e.type === type)

/** The response entry is written after its body is read; wait, so it cannot land in the next test. */
const settled = () => vi.waitFor(() => expect(entries('response')).toHaveLength(1))

/** Like the plugin: stays pending, then rejects with a bare string when its signal aborts. */
function pendingUntilAborted(_url: unknown, init?: { signal?: AbortSignal | null }) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject('Request canceled'))
  })
}

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

describe('loggedFetch request entry', () => {
  it('shows the url, method, redacted headers and described body', async () => {
    mockFetch.mockResolvedValue(new Response('{}'))

    await loggedFetch(
      API_URL,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer sk-1234567890' },
        body: JSON.stringify({ n: 1 }),
      },
      { serviceId: 'svc', timeoutMs: 1_000 },
    )

    expect(entries('request')[0].data).toEqual({
      url: API_URL,
      method: 'POST',
      headers: { Authorization: 'Bear...7890' },
      body: { n: 1 },
    })
    await settled()
  })

  it('defaults the method to GET', async () => {
    mockFetch.mockResolvedValue(new Response('{}'))

    await loggedFetch(API_URL, {}, { serviceId: 'svc', timeoutMs: 1_000 })

    expect(entries('request')[0].data).toMatchObject({ method: 'GET' })
    await settled()
  })
})

describe('loggedFetch failures', () => {
  it('logs a failure that never got a response, and rethrows it', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(loggedFetch(API_URL, {}, { serviceId: 'svc', timeoutMs: 1_000 })).rejects.toThrow(
      'Failed to fetch',
    )

    expect(entries('response')[0]).toMatchObject({
      data: { error: 'Failed to fetch' },
      error: 'Failed to fetch',
    })
  })

  it('logs a caller abort as aborted', async () => {
    mockFetch.mockImplementation(pendingUntilAborted)
    const caller = new AbortController()
    const request = loggedFetch(
      API_URL,
      {},
      { serviceId: 'svc', timeoutMs: 1_000, signal: caller.signal },
    ).catch((e: unknown) => e)

    caller.abort()

    expect(await request).toMatchObject({ name: 'AbortError' })
    expect(entries('response')[0].data).toEqual({ error: 'aborted' })
  })

  it('logs a timeout as the RequestTimeoutError it throws', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(pendingUntilAborted)
    const request = loggedFetch(
      API_URL,
      {},
      { serviceId: 'svc', timeoutMs: 5_000, what: 'Probe' },
    ).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(await request).toBeInstanceOf(RequestTimeoutError)
    expect(entries('response')[0].data).toEqual({ error: 'Probe timed out after 5s' })
  })
})

describe('loggedFetch response', () => {
  it('hands the response to the logger with the entry it belongs to', async () => {
    mockFetch.mockResolvedValue(new Response('{}'))
    const logResponse = vi.fn()

    const response = await loggedFetch(
      API_URL,
      {},
      { serviceId: 'svc', timeoutMs: 1_000, debugId: 'mine', logResponse },
    )

    expect(logResponse).toHaveBeenCalledWith(response, {
      debugId: 'mine',
      serviceId: 'svc',
      startTime: expect.any(Number),
    })
  })

  it('returns the response when the logger throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValue(new Response('{"a":1}'))
    const logResponse = vi.fn(() => {
      throw new Error('boom')
    })

    const response = await loggedFetch(
      API_URL,
      {},
      { serviceId: 'svc', timeoutMs: 1_000, logResponse },
    )

    expect(await response.json()).toEqual({ a: 1 })
    expect(entries('response')).toHaveLength(0)
  })

  it('calls no logger and writes nothing for log: false', async () => {
    mockFetch.mockResolvedValue(new Response('{}'))
    const logResponse = vi.fn()

    await loggedFetch(API_URL, {}, { serviceId: 'svc', timeoutMs: 1_000, log: false, logResponse })

    expect(logResponse).not.toHaveBeenCalled()
    expect(debugLog.snapshot()).toEqual([])
  })

  it('calls no logger while debug mode is off, and the caller reads the whole body', async () => {
    debugLog.active = false
    mockFetch.mockResolvedValue(new Response('{"a":1}'))
    const logResponse = vi.fn()

    const response = await loggedFetch(
      API_URL,
      {},
      { serviceId: 'svc', timeoutMs: 1_000, logResponse },
    )

    expect(logResponse).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ a: 1 })
  })

  it('logs a JSON body through the generic logger and still returns it whole', async () => {
    mockFetch.mockResolvedValue(
      new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }),
    )

    const response = await loggedFetch(API_URL, {}, { serviceId: 'svc', timeoutMs: 1_000 })

    expect(await response.json()).toEqual({ a: 1 })
    await vi.waitFor(() => expect(entries('response')).toHaveLength(1))
    expect(entries('response')[0].data).toEqual({ status: 200, body: { a: 1 } })
  })
})

describe('loggedFetch without a timeout', () => {
  it('passes the callers signal straight to the plugin', async () => {
    mockFetch.mockResolvedValue(new Response('{}'))
    const caller = new AbortController()

    await loggedFetch(API_URL, {}, { serviceId: 'svc', signal: caller.signal })

    expect(mockFetch.mock.calls[0][1]?.signal).toBe(caller.signal)
  })

  it('rethrows an error as the plugin gave it', async () => {
    mockFetch.mockRejectedValue('Request canceled')

    await expect(loggedFetch(API_URL, {}, { serviceId: 'svc' })).rejects.toBe('Request canceled')
  })
})
