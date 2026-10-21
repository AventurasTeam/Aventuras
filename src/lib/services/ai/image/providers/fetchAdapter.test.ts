import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

// The real store is a rune module, which this suite cannot import.
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { isActive: false, addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { isAbortError } from '#lib/services/activity/describeError.ts'
import { RequestTimeoutError } from '#lib/utils/error.ts'
import { fetchPublicImageBase64, imageGetFetch } from './fetchAdapter'

const mockFetch = vi.mocked(tauriHttpFetch)

function redirect(location?: string, status = 302): Response {
  return new Response(null, { status, headers: location ? { location } : {} })
}

function image(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), { status: 200 })
}

describe('fetchPublicImageBase64', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('returns the body of a public URL as base64, following no redirect', async () => {
    mockFetch.mockResolvedValueOnce(image([0x68, 0x69]))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).resolves.toBe('aGk=')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://img.test/a.png',
      expect.objectContaining({ maxRedirections: 0 }),
    )
  })

  it('follows a redirect from one public host to another', async () => {
    mockFetch
      .mockResolvedValueOnce(redirect('https://cdn.test/a.png'))
      .mockResolvedValueOnce(image([0x68, 0x69]))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).resolves.toBe('aGk=')
    expect(mockFetch).toHaveBeenLastCalledWith('https://cdn.test/a.png', expect.anything())
  })

  it('resolves a relative Location against the URL it came from', async () => {
    mockFetch
      .mockResolvedValueOnce(redirect('/moved/a.png', 301))
      .mockResolvedValueOnce(image([0x68, 0x69]))

    await fetchPublicImageBase64('https://img.test/a.png')
    expect(mockFetch).toHaveBeenLastCalledWith('https://img.test/moved/a.png', expect.anything())
  })

  it('refuses a redirect to a private address without requesting it', async () => {
    mockFetch.mockResolvedValueOnce(redirect('http://127.0.0.1:8188/'))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).rejects.toThrow(
      'does not point at a public host',
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a private starting URL without requesting it', async () => {
    await expect(fetchPublicImageBase64('http://169.254.169.254/latest/')).rejects.toThrow(
      'does not point at a public host',
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws on a redirect with no Location', async () => {
    mockFetch.mockResolvedValueOnce(redirect(undefined, 302))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).rejects.toThrow(
      'without a Location',
    )
  })

  it('throws once the redirect limit is passed', async () => {
    mockFetch.mockImplementation(async () => redirect('https://img.test/again.png'))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).rejects.toThrow('too many times')
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('cancels the body of a redirect it follows', async () => {
    const cancel = vi.fn()
    const hop = new Response(new ReadableStream({ cancel }), {
      status: 302,
      headers: { location: 'https://cdn.test/a' },
    })
    mockFetch.mockResolvedValueOnce(hop).mockResolvedValueOnce(image([0x68, 0x69]))

    await fetchPublicImageBase64('https://img.test/a.png')
    expect(cancel).toHaveBeenCalled()
  })

  it('reports an error status instead of reading it as an image', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 404 }))

    await expect(fetchPublicImageBase64('https://img.test/a.png')).rejects.toThrow(
      'Image API error 404',
    )
  })
})

/** Like the plugin: stays pending, then rejects with a bare string when its signal aborts. */
function pendingUntilAborted(_url: unknown, init?: { signal?: AbortSignal | null }) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject('Request canceled'))
  })
}

describe('imageGetFetch abort handling', () => {
  const what = 'Image fetch'
  const run = (signal: AbortSignal | undefined, timeoutMs: number) =>
    imageGetFetch('https://img.test/a.png', undefined, { signal, timeoutMs })

  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(pendingUntilAborted)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a caller abort as an AbortError', async () => {
    const caller = new AbortController()
    const request = run(caller.signal, 60_000).catch((e: unknown) => e)

    caller.abort()

    const error = await request
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(isAbortError(error)).toBe(true)
  })

  it('rejects a timeout as a RequestTimeoutError, not an abort', async () => {
    vi.useFakeTimers()
    const request = run(new AbortController().signal, 5_000).catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(5_000)

    const error = await request
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: `${what} timed out after 5s` })
    expect(isAbortError(error)).toBe(false)
  })
})

describe('imageGetFetch body timeout', () => {
  const what = 'Image fetch'
  const run = (timeoutMs: number) =>
    imageGetFetch('https://img.test/a.png', undefined, { timeoutMs })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('errors a body that stalls after the headers with a RequestTimeoutError', async () => {
    vi.useFakeTimers()
    mockFetch.mockReset()
    mockFetch.mockImplementation(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start: (c) => init?.signal?.addEventListener('abort', () => c.error('Request cancelled')),
      })
      return new Response(body, { status: 200 })
    })

    const response = await run(5_000)
    const read = response.arrayBuffer().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)

    const error = await read
    expect(error).toBeInstanceOf(RequestTimeoutError)
    expect(error).toMatchObject({ message: `${what} timed out after 5s` })
  })
})

describe('request headers', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(async () => new Response('{}', { status: 200 }))
  })

  it('imageGetFetch sends an empty Origin', async () => {
    await imageGetFetch('https://img.test/a.png', { Authorization: 'Bearer key' })

    const headers = new Headers(mockFetch.mock.calls[0][1]?.headers)
    expect(headers.get('origin')).toBe('')
    expect(headers.get('authorization')).toBe('Bearer key')
  })
})
