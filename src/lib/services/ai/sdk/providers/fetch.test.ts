import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

// The real store is a rune module, which this suite cannot import.
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { isActive: false, addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { isAbortError } from '#lib/services/activity/describeError.ts'
import { RequestTimeoutError } from '#lib/utils/error.ts'
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
