import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { ReplyCutOffError, type ReplyCutOffFailure } from '../reply-cut-off'
import { callWithRetry } from './call-with-retry'

const opts = (signal: AbortSignal) => ({ maxProviderAttempts: 3, maxParseAttempts: 3, signal })
const auth = () =>
  new APICallError({ message: 'unauthorized', url: 'u', requestBodyValues: {}, statusCode: 401 })
const server = () =>
  new APICallError({ message: 'boom', url: 'u', requestBodyValues: {}, statusCode: 503 })

describe('callWithRetry', () => {
  it('returns ok on first success with no recoverable errors', async () => {
    const res = await callWithRetry(
      async () => '{"v":1}',
      (raw) => JSON.parse(raw),
      opts(new AbortController().signal),
    )
    expect(res).toEqual({ status: 'ok', result: { v: 1 }, recoverable: [] })
  })

  it('retries a retryable provider error then succeeds', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const promise = callWithRetry(
        async () => {
          if (n++ === 0) throw server()
          return '{"v":2}'
        },
        (raw) => JSON.parse(raw),
        opts(new AbortController().signal),
      )
      await vi.advanceTimersByTimeAsync(60000)
      const res = await promise
      expect(res.status).toBe('ok')
      expect(res.recoverable).toHaveLength(1)
      expect(res.recoverable[0]).toMatchObject({ tier: 'provider', reason: 'network' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('short-circuits on a non-retryable auth error', async () => {
    const res = await callWithRetry(
      async () => {
        throw auth()
      },
      (raw) => JSON.parse(raw),
      opts(new AbortController().signal),
    )
    expect(res.status).toBe('failed')
    expect(res.recoverable).toHaveLength(0)
    if (res.status === 'failed')
      expect(res.error).toMatchObject({ tier: 'provider', reason: 'auth' })
  })

  it('exhausts provider attempts then fails', async () => {
    vi.useFakeTimers()
    try {
      const promise = callWithRetry(
        async () => {
          throw server()
        },
        (raw) => JSON.parse(raw),
        { maxProviderAttempts: 2, maxParseAttempts: 2, signal: new AbortController().signal },
      )
      await vi.advanceTimersByTimeAsync(60000)
      const res = await promise
      expect(res.status).toBe('failed')
      expect(res.recoverable).toHaveLength(1) // attempts - 1
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces an aborted signal without retrying', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const res = await callWithRetry(
      async () => {
        throw new Error('should not be called')
      },
      (raw) => JSON.parse(raw),
      opts(ctrl.signal),
    )
    expect(res.status).toBe('aborted')
  })

  it('retries a parse failure then succeeds', async () => {
    let n = 0
    const res = await callWithRetry(
      async () => (n++ === 0 ? 'not json' : '{"v":3}'),
      (raw) => JSON.parse(raw),
      opts(new AbortController().signal),
    )
    expect(res.status).toBe('ok')
    expect(res.recoverable).toHaveLength(1)
    expect(res.recoverable[0]).toMatchObject({ tier: 'parse', attempt: 0 })
  })

  it('exhausts parse attempts then fails', async () => {
    const res = await callWithRetry(
      async () => 'not json',
      (raw) => JSON.parse(raw),
      { maxProviderAttempts: 3, maxParseAttempts: 2, signal: new AbortController().signal },
    )
    expect(res.status).toBe('failed')
    expect(res.recoverable).toHaveLength(1)
    if (res.status === 'failed') expect(res.error.tier).toBe('parse')
  })

  it('waits Retry-After before the next provider attempt', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const ra = new APICallError({
        message: 'rl',
        url: 'u',
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { 'retry-after': '2' },
      })
      const promise = callWithRetry(
        async () => {
          if (n++ === 0) throw ra
          return '{"v":9}'
        },
        (raw) => JSON.parse(raw),
        { maxProviderAttempts: 2, maxParseAttempts: 2, signal: new AbortController().signal },
      )
      await vi.advanceTimersByTimeAsync(1999)
      await vi.advanceTimersByTimeAsync(2)
      const res = await promise
      expect(res.status).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts mid-backoff', async () => {
    vi.useFakeTimers()
    try {
      const ctrl = new AbortController()
      const ra = new APICallError({
        message: 'rl',
        url: 'u',
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { 'retry-after': '5' },
      })
      const promise = callWithRetry(
        async () => {
          throw ra
        },
        (raw) => JSON.parse(raw),
        { maxProviderAttempts: 3, maxParseAttempts: 2, signal: ctrl.signal },
      )
      await vi.advanceTimersByTimeAsync(100)
      ctrl.abort()
      await vi.advanceTimersByTimeAsync(100)
      const res = await promise
      expect(res.status).toBe('aborted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps an unreasonably large Retry-After at the backoff cap', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const ra = new APICallError({
        message: 'rl',
        url: 'u',
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { 'retry-after': '3600' },
      })
      const promise = callWithRetry(
        async () => {
          if (n++ === 0) throw ra
          return '{"v":1}'
        },
        (raw) => JSON.parse(raw),
        { maxProviderAttempts: 2, maxParseAttempts: 2, signal: new AbortController().signal },
      )
      // Still backing off just before the 30s cap...
      await vi.advanceTimersByTimeAsync(29_999)
      // ...and retries right after it, not after the full 3600s.
      await vi.advanceTimersByTimeAsync(2)
      const res = await promise
      expect(res.status).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })
})

const CUT: ReplyCutOffFailure = {
  cause: 'max-output',
  outputTokens: 256,
  reasoningTokens: null,
  maxOutput: 256,
  window: null,
  providerId: 'prov-1',
  modelId: 'model-1',
}

function cutOff(): never {
  throw new ReplyCutOffError(CUT)
}

// generation-pipeline.md → Two retry tiers: a reply-cut-off failure isn't retried.
describe('callWithRetry with a cut-off reply', () => {
  it('parses the raw reply type the call returns', async () => {
    const res = await callWithRetry(
      async () => ({ text: '{"v":1}', finishReason: 'stop' }),
      (raw) => JSON.parse(raw.text) as { v: number },
      opts(new AbortController().signal),
    )
    expect(res).toEqual({ status: 'ok', result: { v: 1 }, recoverable: [] })
  })

  it('returns a cut-off its parse step throws as failed, after a single call', async () => {
    const callFn = vi.fn(async () => 'cut reply')
    const parseFn = vi.fn(cutOff)
    const res = await callWithRetry(callFn, parseFn, opts(new AbortController().signal))
    expect(res).toEqual({
      status: 'failed',
      error: { tier: 'reply-cut-off', ...CUT },
      recoverable: [],
    })
    expect(callFn).toHaveBeenCalledOnce()
    expect(parseFn).toHaveBeenCalledOnce()
  })

  it('keeps the provider retry that came before the cut-off', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const callFn = vi.fn(async () => {
        if (n++ === 0) throw server()
        return 'cut reply'
      })
      const promise = callWithRetry(callFn, cutOff, opts(new AbortController().signal))
      await vi.advanceTimersByTimeAsync(60000)
      expect(await promise).toEqual({
        status: 'failed',
        error: { tier: 'reply-cut-off', ...CUT },
        recoverable: [{ tier: 'provider', reason: 'network', detail: expect.any(String) }],
      })
      expect(callFn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // With two parse attempts, a cut-off counted as the second would end as a parse failure.
  it('fails a cut-off after a parse retry as reply-cut-off, the parse retry kept', async () => {
    let n = 0
    const callFn = vi.fn(async () => (n++ === 0 ? 'not json' : 'cut reply'))
    const res = await callWithRetry(
      callFn,
      (raw) => (raw === 'cut reply' ? cutOff() : JSON.parse(raw)),
      { maxProviderAttempts: 2, maxParseAttempts: 2, signal: new AbortController().signal },
    )
    expect(res).toEqual({
      status: 'failed',
      error: { tier: 'reply-cut-off', ...CUT },
      recoverable: [{ tier: 'parse', detail: expect.any(String), attempt: 0 }],
    })
    expect(callFn).toHaveBeenCalledTimes(2)
  })

  it('still retries any other error its parse step throws', async () => {
    let n = 0
    const callFn = vi.fn(async () => 'reply')
    const res = await callWithRetry(
      callFn,
      () => {
        if (n++ === 0) throw new Error('not a document')
        return { v: 4 }
      },
      { maxProviderAttempts: 2, maxParseAttempts: 2, signal: new AbortController().signal },
    )
    expect(res).toEqual({
      status: 'ok',
      result: { v: 4 },
      recoverable: [{ tier: 'parse', detail: 'not a document', attempt: 0 }],
    })
    expect(callFn).toHaveBeenCalledTimes(2)
  })

  it('treats a cut-off thrown by the call itself as a provider failure, retried', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const callFn = vi.fn(async () => {
        if (n++ === 0) throw new ReplyCutOffError(CUT)
        return '{"v":5}'
      })
      const promise = callWithRetry(callFn, (raw) => JSON.parse(raw), {
        maxProviderAttempts: 2,
        maxParseAttempts: 2,
        signal: new AbortController().signal,
      })
      await vi.advanceTimersByTimeAsync(60000)
      expect(await promise).toEqual({
        status: 'ok',
        result: { v: 5 },
        recoverable: [
          { tier: 'provider', reason: 'unknown', detail: expect.stringContaining('max-output') },
        ],
      })
      expect(callFn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
