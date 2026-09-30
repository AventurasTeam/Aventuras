import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

import { retryOn429Middleware } from './retryMiddleware'

const rateLimited = (retryAfter?: string) =>
  Object.assign(new Error('Too Many Requests'), {
    statusCode: 429,
    responseHeaders: retryAfter ? { 'retry-after': retryAfter } : {},
  })

/** Calls the middleware's generate wrapper the way the SDK does. */
function generate(doGenerate: () => Promise<unknown>, abortSignal?: AbortSignal) {
  return (retryOn429Middleware().wrapGenerate as any)({
    doGenerate,
    doStream: vi.fn(),
    params: { abortSignal },
    model: {},
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('retryOn429Middleware', () => {
  it('retries a 429 after backing off, and returns the success', async () => {
    const doGenerate = vi
      .fn()
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce({ text: 'ok' })

    const result = generate(doGenerate)
    await vi.advanceTimersByTimeAsync(11_000)

    await expect(result).resolves.toEqual({ text: 'ok' })
    expect(doGenerate).toHaveBeenCalledTimes(2)
  })

  it('gives up after three retries and rethrows the last 429', async () => {
    const error = rateLimited()
    const doGenerate = vi.fn().mockRejectedValue(error)

    const result = generate(doGenerate)
    const settled = expect(result).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(70_000)

    await settled
    expect(doGenerate).toHaveBeenCalledTimes(4)
  })

  it('waits for Retry-After rather than the default backoff', async () => {
    const doGenerate = vi
      .fn()
      .mockRejectedValueOnce(rateLimited('2'))
      .mockResolvedValueOnce({ text: 'ok' })

    const result = generate(doGenerate)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(doGenerate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toEqual({ text: 'ok' })
  })

  it('rethrows at once when Retry-After exceeds the timeout', async () => {
    const error = rateLimited('600')
    const doGenerate = vi.fn().mockRejectedValue(error)

    await expect(generate(doGenerate)).rejects.toBe(error)
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })

  it('rethrows anything but a 429 without retrying', async () => {
    const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    const doGenerate = vi.fn().mockRejectedValue(error)

    await expect(generate(doGenerate)).rejects.toBe(error)
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the request is aborted', async () => {
    const controller = new AbortController()
    const doGenerate = vi.fn().mockRejectedValue(rateLimited())

    const result = generate(doGenerate, controller.signal)
    const settled = expect(result).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort(new Error('stopped'))

    await settled
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })
})
