import { afterEach, describe, expect, it, vi } from 'vitest'

import { runProviderCall, streamProviderCall } from './provider-call'

const generateTextMock = vi.fn()
const streamTextMock = vi.fn()
vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return {
    ...real,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    streamText: (...args: unknown[]) => streamTextMock(...args),
  }
})

afterEach(() => {
  generateTextMock.mockReset()
  streamTextMock.mockReset()
})

describe('runProviderCall', () => {
  it('forces maxRetries:0 and passes the full options through to generateText', async () => {
    generateTextMock.mockResolvedValue({ text: 'hello' })
    const signal = new AbortController().signal
    const result = await runProviderCall({
      model: {} as never,
      prompt: 'go',
      abortSignal: signal,
      timeout: { totalMs: 60000, stepMs: 10000, chunkMs: 5000 },
      temperature: 0.7,
    })
    expect(result).toEqual({ text: 'hello' })
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
        prompt: 'go',
        abortSignal: signal,
        timeout: { totalMs: 60000, stepMs: 10000, chunkMs: 5000 },
        temperature: 0.7,
      }),
    )
  })

  it('overrides a caller-supplied maxRetries with 0', async () => {
    generateTextMock.mockResolvedValue({ text: 'ok' })
    await runProviderCall({ model: {} as never, prompt: 'go', maxRetries: 5 })
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })
})

describe('streamProviderCall', () => {
  it('forces maxRetries:0 on streamText', () => {
    streamTextMock.mockReturnValue({ textStream: {} })
    streamProviderCall({ model: {} as never, prompt: 'go', timeout: { chunkMs: 5000 } })
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, prompt: 'go', timeout: { chunkMs: 5000 } }),
    )
  })
})
