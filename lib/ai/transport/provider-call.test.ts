import { afterEach, describe, expect, it, vi } from 'vitest'

import { runProviderCall } from './provider-call'

const generateTextMock = vi.fn()
vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, generateText: (...args: unknown[]) => generateTextMock(...args) }
})

afterEach(() => generateTextMock.mockReset())

describe('runProviderCall', () => {
  it('passes maxRetries:0 and the timeout config to the SDK', async () => {
    generateTextMock.mockResolvedValue({ text: 'hello' })
    const signal = new AbortController().signal
    const fakeModel = {} as never
    const text = await runProviderCall(fakeModel, {
      prompt: 'go',
      signal,
      timeout: { totalMs: 60000, stepMs: 10000, chunkMs: 5000 },
    })
    expect(text).toBe('hello')
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        timeout: { totalMs: 60000, stepMs: 10000, chunkMs: 5000 },
        abortSignal: signal,
        prompt: 'go',
      }),
    )
  })

  it('rethrows an APICallError unchanged so the classifier can map it', async () => {
    const { APICallError } = await import('ai')
    const apiErr = new APICallError({
      message: 'x',
      url: 'u',
      requestBodyValues: {},
      statusCode: 503,
    })
    generateTextMock.mockRejectedValue(apiErr)
    await expect(
      runProviderCall({} as never, {
        prompt: 'go',
        signal: new AbortController().signal,
        timeout: {},
      }),
    ).rejects.toBe(apiErr)
  })

  it('maps an internal timeout (signal not aborted) to ProviderTimeoutError', async () => {
    generateTextMock.mockRejectedValue(new Error('AbortError: timeout'))
    const { ProviderTimeoutError } = await import('./classify-provider-error')
    await expect(
      runProviderCall({} as never, {
        prompt: 'go',
        signal: new AbortController().signal,
        timeout: {},
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError)
  })
})
