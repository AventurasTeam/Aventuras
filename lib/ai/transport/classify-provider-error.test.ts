import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import { ProviderTimeoutError, classifyProviderError } from './classify-provider-error'

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
})
