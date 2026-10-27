import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  capabilityHintOf,
  classifyProviderError,
  describeProviderError,
  ProviderTimeoutError,
  recognizeOverflow,
} from './classify-provider-error'

function apiError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://api.test/v1',
    requestBodyValues: {},
    statusCode,
  })
}

const LLAMACPP_BODY = JSON.stringify({
  error: {
    code: 400,
    message:
      'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it',
    type: 'exceed_context_size_error',
    n_prompt_tokens: 71834,
    n_ctx: 65536,
  },
})
const OPENAI_BODY = JSON.stringify({
  error: {
    message:
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
    type: 'invalid_request_error',
    param: 'messages',
    code: 'context_length_exceeded',
  },
})
const ANTHROPIC_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'prompt is too long: 210000 tokens > 200000 maximum',
  },
})

// An APICallError as the SDK builds one from a rejected request: the body verbatim, and for an
// unparsed body the status text as its message.
function rejection(
  statusCode: number | undefined,
  responseBody?: string,
  message = 'Bad Request',
): APICallError {
  return new APICallError({
    message,
    url: 'https://api.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    ...(responseBody !== undefined ? { responseBody } : {}),
  })
}

const errorBody = (message: string): string =>
  JSON.stringify({ error: { message, type: 'invalid_request_error' } })

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

  // architecture.md → Recognizing an overflow rejection: the same prompt overflows again.
  it('never retries a recognized overflow, on a 429 or a 5xx too', () => {
    for (const status of [400, 429, 500, 503]) {
      expect(classifyProviderError(rejection(status, LLAMACPP_BODY)).retryable).toBe(false)
    }
    expect(classifyProviderError(rejection(503, errorBody('upstream busy'))).retryable).toBe(true)
  })

  it.each([
    [400, 'unknown'],
    [401, 'auth'],
    [403, 'auth'],
    [429, 'network'],
  ] as const)('attaches a capability hint to a %i whose body names one', (status, reason) => {
    expect(
      classifyProviderError(rejection(status, errorBody('thinking is not supported'))).error,
    ).toEqual({
      tier: 'provider',
      reason,
      detail: expect.any(String),
      possibleCapabilityMismatch: { capability: 'reasoning', matched: 'thinking' },
    })
  })

  it('attaches no hint to a 5xx or to a body recognized as an overflow', () => {
    const server = classifyProviderError(rejection(500, errorBody('thinking failed upstream')))
    const overflow = classifyProviderError(
      rejection(400, errorBody('prompt is too long once thinking is included')),
    )
    expect('possibleCapabilityMismatch' in server.error).toBe(false)
    expect('possibleCapabilityMismatch' in overflow.error).toBe(false)
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

// architecture.md → Recognizing an overflow rejection.
describe('recognizeOverflow', () => {
  it.each([
    [
      "llama.cpp's",
      LLAMACPP_BODY,
      'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it',
    ],
    [
      "OpenAI's",
      OPENAI_BODY,
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
    ],
    ["Anthropic's", ANTHROPIC_BODY, 'prompt is too long: 210000 tokens > 200000 maximum'],
  ])('recognizes %s overflow body and quotes its message', (_label, body, detail) => {
    expect(recognizeOverflow(rejection(400, body))).toEqual({ detail })
  })

  // Each message holds no keyword, so only the code lookup can recognize it.
  it.each([
    ['error.type', { error: { message: 'request rejected', type: 'exceed_context_size_error' } }],
    [
      'error.code',
      {
        error: {
          message: 'request rejected',
          type: 'invalid_request_error',
          code: 'context_length_exceeded',
        },
      },
    ],
    [
      'a top-level code',
      { object: 'error', message: 'request rejected', code: 'context_length_exceeded' },
    ],
  ])('recognizes an overflow code in %s', (_label, body) => {
    expect(recognizeOverflow(rejection(400, JSON.stringify(body)))).toEqual({
      detail: 'request rejected',
    })
  })

  it.each([
    ['maximum context length', 'This model has a Maximum Context Length of 4096 tokens'],
    ['context size', 'the request exceeds the available Context Size'],
    ['context window', "Input exceeds the model's Context Window"],
    ['prompt is too long', 'Prompt is too long: 9000 tokens'],
    [
      'input token count',
      'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
    ],
    [
      'max_new_tokens must be',
      'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 4096. Given: 4000 `inputs` tokens and 500 `max_new_tokens`',
    ],
  ])('recognizes the keyword %s, in any case', (_keyword, message) => {
    expect(recognizeOverflow(rejection(400, errorBody(message)))).toEqual({ detail: message })
  })

  it('recognizes an overflow on a 5xx', () => {
    expect(recognizeOverflow(rejection(500, LLAMACPP_BODY))).not.toBeNull()
  })

  it("quotes TGI's error string", () => {
    const message =
      'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 4096. Given: 4000 `inputs` tokens and 500 `max_new_tokens`'
    const body = JSON.stringify({ error: message, error_type: 'validation' })
    expect(recognizeOverflow(rejection(422, body))).toEqual({ detail: message })
  })

  it("quotes vLLM's top-level message", () => {
    const message =
      "This model's maximum context length is 4096 tokens. However, you requested 5000 tokens."
    const body = JSON.stringify({ object: 'error', message, type: 'BadRequestError', code: 400 })
    expect(recognizeOverflow(rejection(400, body))).toEqual({ detail: message })
  })

  // A recognized code with an empty message must not quote nothing: the raw body is the next evidence.
  it.each(['', '   '])('quotes the raw body when the provider message is %j', (message) => {
    const body = JSON.stringify({ error: { message, code: 'context_length_exceeded' } })
    expect(recognizeOverflow(rejection(400, body))).toEqual({ detail: body })
  })

  // The SDK's message for a body it couldn't parse is the status text, which says nothing.
  it('quotes a body that is not JSON, not the status text', () => {
    expect(recognizeOverflow(rejection(400, 'Prompt is too long for this model.\n'))).toEqual({
      detail: 'Prompt is too long for this model.',
    })
  })

  it('reads the parsed data when the error carries no body', () => {
    const error = new APICallError({
      message: 'request rejected',
      url: 'https://api.test/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400,
      data: { error: { message: 'request rejected', code: 'context_length_exceeded' } },
    })
    expect(recognizeOverflow(error)).toEqual({ detail: 'request rejected' })
  })

  it("searches and quotes the error's own message when there is no body", () => {
    const error = rejection(400, undefined, 'prompt is too long: 9000 tokens')
    expect(recognizeOverflow(error)).toEqual({ detail: 'prompt is too long: 9000 tokens' })
  })

  // The search reads the whole body; the quoted detail is still the message first.
  it('finds a keyword outside the message and quotes the message', () => {
    const body = JSON.stringify({
      error: {
        message: 'Provider returned error',
        code: 400,
        metadata: {
          raw: "This model's maximum context length is 8192 tokens. However, you requested 9000.",
        },
      },
    })
    expect(recognizeOverflow(rejection(400, body))).toEqual({ detail: 'Provider returned error' })
  })

  it('does not recognize a 400 that names no overflow', () => {
    expect(recognizeOverflow(rejection(400, errorBody('temperature must be at most 2')))).toBeNull()
  })

  it('does not recognize anything but an APICallError', () => {
    expect(recognizeOverflow(new Error('maximum context length exceeded'))).toBeNull()
  })

  it('does not recognize an APICallError without a status', () => {
    expect(recognizeOverflow(rejection(undefined, undefined, 'maximum context length'))).toBeNull()
  })

  // A 2xx APICallError is a reply the SDK couldn't read; its body is the model's own text.
  it('does not recognize a successful response the SDK failed to read', () => {
    const body = '{"choices":[{"message":{"content":"The ship\'s context window flickered"'
    expect(recognizeOverflow(rejection(200, body, 'Invalid JSON response'))).toBeNull()
  })
})

// generation-pipeline.md → Fatal error categories: provider.possibleCapabilityMismatch.
describe('capabilityHintOf', () => {
  it.each([
    ['response_format is not supported by this model', 'structuredOutput', 'response_format'],
    ['json_schema is not supported by this model', 'structuredOutput', 'json_schema'],
    ['budget_tokens must be at least 1024', 'reasoning', 'budget_tokens'],
    ['thinking is not enabled for this model', 'reasoning', 'thinking'],
    ['reasoning_effort is not supported', 'reasoning', 'reasoning'],
  ] as const)('reads %j as a %s hint', (message, capability, matched) => {
    expect(capabilityHintOf(rejection(400, errorBody(message)))).toEqual({ capability, matched })
  })

  it('takes the first keyword in its order: a parameter name before a generic word', () => {
    expect(
      capabilityHintOf(rejection(400, errorBody('json_schema not supported for reasoning models'))),
    ).toEqual({ capability: 'structuredOutput', matched: 'json_schema' })
    expect(
      capabilityHintOf(
        rejection(
          400,
          errorBody('thinking.budget_tokens: Input should be greater than or equal to 1024'),
        ),
      ),
    ).toEqual({ capability: 'reasoning', matched: 'budget_tokens' })
  })

  it('matches in any case', () => {
    expect(capabilityHintOf(rejection(400, errorBody('THINKING is not supported')))).toEqual({
      capability: 'reasoning',
      matched: 'thinking',
    })
  })

  it('reads every 4xx and nothing outside it', () => {
    const body = errorBody('thinking is not supported')
    expect(capabilityHintOf(rejection(499, body))).toEqual({
      capability: 'reasoning',
      matched: 'thinking',
    })
    expect(capabilityHintOf(rejection(500, body))).toBeUndefined()
    expect(capabilityHintOf(rejection(399, body))).toBeUndefined()
  })

  it('finds a keyword outside the message, such as the offending param', () => {
    const body = JSON.stringify({
      error: {
        message: 'Invalid parameter.',
        type: 'invalid_request_error',
        param: 'response_format',
      },
    })
    expect(capabilityHintOf(rejection(400, body))).toEqual({
      capability: 'structuredOutput',
      matched: 'response_format',
    })
  })

  it('gives no hint for a body recognized as an overflow', () => {
    const body = errorBody('prompt is too long once thinking is included')
    expect(capabilityHintOf(rejection(400, body))).toBeUndefined()
  })

  it('gives no hint for anything but an APICallError', () => {
    expect(capabilityHintOf(new Error('thinking is not supported'))).toBeUndefined()
  })
})
