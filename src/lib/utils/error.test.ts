import { describe, it, expect } from 'vitest'
import { describeLoadError, errorSummary, HttpStatusError, providerMessage } from './error'

describe('describeLoadError', () => {
  it("leads with a provider's JSON error message and keeps the whole error as the detail", () => {
    const error = new HttpStatusError(401, '{"error":{"message":"Invalid API key"}}', 'Image API')
    expect(describeLoadError(error)).toEqual({
      summary: '401 · Invalid API key',
      detail: 'Image API error 401: {"error":{"message":"Invalid API key"}}',
    })
  })

  it('falls back to the first line of a body that is not JSON', () => {
    const error = new HttpStatusError(502, '<html>\n<body>Bad gateway</body>\n</html>', 'Image API')
    expect(describeLoadError(error).summary).toBe('502 · <html>')
  })

  it('uses the first line of any other error', () => {
    expect(describeLoadError(new Error('boom\nstack'))).toEqual({
      summary: 'boom',
      detail: 'boom\nstack',
    })
  })

  it('accepts a string rejection', () => {
    expect(describeLoadError('Request failed')).toEqual({
      summary: 'Request failed',
      detail: 'Request failed',
    })
  })
})

describe('errorSummary', () => {
  it('returns a single short line unchanged', () => {
    expect(errorSummary('Image API error 401: bad key')).toBe('Image API error 401: bad key')
  })

  it('keeps only the first line of a multi-line message', () => {
    expect(errorSummary('Image API error 502: <html>\n<body>Bad gateway</body>\n</html>')).toBe(
      'Image API error 502: <html>',
    )
  })

  it('skips blank leading lines', () => {
    expect(errorSummary('\n  \n  boom  \nmore')).toBe('boom')
  })

  it('cuts a long line to the limit, ending in an ellipsis', () => {
    const summary = errorSummary('x'.repeat(500), 200)
    expect(summary).toHaveLength(200)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('gives an empty string for blank text', () => {
    expect(errorSummary(' \n ')).toBe('')
  })
})

describe('providerMessage', () => {
  it.each([
    [
      'a nested error message',
      '{"error":{"message":"Invalid API key","code":"x"}}',
      'Invalid API key',
    ],
    [
      'a string error',
      '{"error":"Unable to load the image","code":"BAD"}',
      'Unable to load the image',
    ],
    ['a top-level message', '{"message":"Slow down"}', 'Slow down'],
    ['a detail', '{"detail":"Sampler not found"}', 'Sampler not found'],
    [
      'a nested message over a top-level one',
      '{"error":{"message":"inner"},"message":"outer"}',
      'inner',
    ],
  ])('reads %s', (_, body, expected) => {
    expect(providerMessage(body)).toBe(expected)
  })

  it.each([
    ['an empty nested message', '{"error":{"message":""}}'],
    ['empty strings', '{"error":"","message":"","detail":""}'],
    ['a body that is not JSON', '<html>Bad gateway</html>'],
    ['a JSON array', '[1, 2]'],
    ['a JSON string', '"boom"'],
    ['an object with none of the fields', '{"status":"failed"}'],
    ['an empty body', ''],
    ['no body', undefined],
  ])('finds nothing in %s', (_, body) => {
    expect(providerMessage(body)).toBeNull()
  })
})
