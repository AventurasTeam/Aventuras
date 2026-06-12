import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

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
})
