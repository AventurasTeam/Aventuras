import { describe, it, expect } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { ATTEMPT_NUMBER, describeActivityError } from './describeError'

const apiError = (statusCode: number | undefined, responseBody?: string) =>
  new APICallError({
    message: 'Bad Request',
    url: 'https://example.test/v1/chat',
    requestBodyValues: {},
    statusCode,
    responseBody,
  })

describe('describeActivityError', () => {
  it('gives the status and the provider message from an OpenAI-style body', () => {
    const error = apiError(401, JSON.stringify({ error: { message: 'invalid API key' } }))
    expect(describeActivityError(error)).toBe('401 · invalid API key')
  })

  it('reads a top-level message or a string error field', () => {
    expect(describeActivityError(apiError(429, '{"message":"slow down"}'))).toBe('429 · slow down')
    expect(describeActivityError(apiError(500, '{"error":"upstream failed"}'))).toBe(
      '500 · upstream failed',
    )
  })

  it("falls back to the error's own message when the body is not JSON", () => {
    expect(describeActivityError(apiError(502, '<html>Bad Gateway</html>'))).toBe(
      '502 · Bad Request',
    )
  })

  it('omits the status when the error carries none', () => {
    expect(describeActivityError(apiError(undefined))).toBe('Bad Request')
  })

  it('says a retried request ran out of retries, counting the attempts the SDK saw', () => {
    const error = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429), apiError(429), apiError(429)],
    })
    expect(describeActivityError(error)).toBe('Failed after 3 attempts, with no retries left')
  })

  it('counts every attempt the app made when its last attempt was numbered', () => {
    const last = Object.assign(apiError(429), { [ATTEMPT_NUMBER]: 12 })
    const error = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429), apiError(429), last],
    })
    expect(describeActivityError(error)).toBe('Failed after 12 attempts, with no retries left')
  })

  it('names the attempt a request finally failed on when it was not retried further', () => {
    const error = Object.assign(apiError(401, '{"error":{"message":"bad key"}}'), {
      [ATTEMPT_NUMBER]: 3,
    })
    expect(describeActivityError(error)).toBe('401 · bad key (on attempt 3)')
  })

  it('uses the message of any other error, and stringifies a non-error', () => {
    expect(describeActivityError(new Error('template not found'))).toBe('template not found')
    expect(describeActivityError('boom')).toBe('boom')
  })

  it('returns null for an abort', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(describeActivityError(abort)).toBeNull()
  })

  it('caps a long reason', () => {
    const reason = describeActivityError(new Error('x'.repeat(1000)))!
    expect(reason.length).toBe(300)
    expect(reason.endsWith('…')).toBe(true)
  })
})
