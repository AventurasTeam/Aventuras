import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  ProviderTimeoutError,
  classifyProviderError,
  describeProviderError,
} from './classify-provider-error'

function apiError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://api.test/v1',
    requestBodyValues: {},
    statusCode,
  })
}

describe('classifyProviderError', () => {
  it('maps a ProviderTimeoutError to a retryable timeout', () => {
    expect(classifyProviderError(new ProviderTimeoutError())).toEqual({
      error: { tier: 'provider', reason: 'timeout' },
      retryable: true,
    })
  })

  it('maps 401/403 to a non-retryable auth error', () => {
    expect(classifyProviderError(apiError(401))).toMatchObject({
      error: { tier: 'provider', reason: 'auth' },
      retryable: false,
    })
    expect(classifyProviderError(apiError(403)).retryable).toBe(false)
  })

  it('maps other 4xx to a non-retryable unknown error', () => {
    expect(classifyProviderError(apiError(422))).toMatchObject({
      error: { tier: 'provider', reason: 'unknown' },
      retryable: false,
    })
  })

  it('maps 5xx and undefined status to a retryable network error', () => {
    expect(classifyProviderError(apiError(503)).retryable).toBe(true)
    expect(classifyProviderError(apiError(undefined)).retryable).toBe(true)
  })

  it('treats an unknown thrown value as a retryable network error', () => {
    expect(classifyProviderError(new Error('boom'))).toMatchObject({
      error: { tier: 'provider', reason: 'unknown', detail: 'boom' },
      retryable: true,
    })
  })

  it('extracts Retry-After seconds into retryAfterMs', () => {
    const err = new APICallError({
      message: 'rate limited',
      url: 'https://api.test/v1',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { 'retry-after': '2' },
    })
    const out = classifyProviderError(err)
    expect(out.retryable).toBe(true)
    expect(out.retryAfterMs).toBe(2000)
  })

  it('returns undefined retryAfterMs when the header is absent', () => {
    expect(classifyProviderError(apiError(503)).retryAfterMs).toBeUndefined()
  })
})

describe('describeProviderError', () => {
  // The shape the AI SDK produces when a response handler throws: the envelope
  // names itself, the root cause is one link down (post-to-api.ts).
  function wrapped(cause: Error): APICallError {
    return new APICallError({
      message: 'Failed to process successful response',
      cause,
      statusCode: 200,
      url: 'https://api.test/v1/chat/completions',
      requestBodyValues: {},
    })
  }

  it('names the root cause, not just the envelope', () => {
    const inner = new Error('Empty response body')
    inner.name = 'EmptyResponseBodyError'
    expect(describeProviderError(wrapped(inner))).toBe(
      'APICallError: Failed to process successful response ← EmptyResponseBodyError: Empty response body',
    )
  })

  it('walks a multi-link chain', () => {
    const root = new Error('invalid json')
    const mid = new Error('type validation failed', { cause: root })
    expect(describeProviderError(wrapped(mid))).toBe(
      'APICallError: Failed to process successful response ← type validation failed ← invalid json',
    )
  })

  it('does not repeat a name already carried by the message', () => {
    const inner = new Error('TypeValidationError: bad shape')
    inner.name = 'TypeValidationError'
    expect(describeProviderError(inner)).toBe('TypeValidationError: bad shape')
  })

  it('collapses a link whose label repeats the one before it', () => {
    const root = new Error('same')
    expect(describeProviderError(new Error('same', { cause: root }))).toBe('same')
  })

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a')
    const b = new Error('b')
    ;(a as { cause?: unknown }).cause = b
    ;(b as { cause?: unknown }).cause = a
    expect(describeProviderError(a)).toBe('a ← b ← a ← b ← a')
  })

  it('handles non-Error throwables', () => {
    expect(describeProviderError('boom')).toBe('boom')
    expect(describeProviderError(undefined)).toBe('')
  })

  it('labels a throwable that cannot be coerced to a string', () => {
    expect(describeProviderError(Object.create(null))).toBe('[uncoercible value]')
  })
})
