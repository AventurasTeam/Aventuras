import { describe, it, expect } from 'vitest'
import { APICallError } from 'ai'
import {
  definedHeaders,
  fileBase64,
  fileBytes,
  httpError,
  inlineFile,
  parseJson,
  responseExcerpt,
  unsupportedInputWarnings,
  type ReferenceFile,
} from './imageModelUtils'

const PNG = 'iVBORw0KGgo='

describe('parseJson', () => {
  it('parses JSON and gives undefined for anything else', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson('<html>gateway</html>')).toBeUndefined()
    expect(parseJson('')).toBeUndefined()
  })
})

describe('responseExcerpt', () => {
  it('trims the body and cuts it at 200 characters', () => {
    expect(responseExcerpt('  Bad gateway \n', 502)).toBe('Bad gateway')
    expect(responseExcerpt('x'.repeat(500), 500)).toHaveLength(200)
  })

  it('names the status when the body is blank', () => {
    expect(responseExcerpt('', 503)).toBe('HTTP 503')
    expect(responseExcerpt('  \n ', 503)).toBe('HTTP 503')
  })
})

describe('httpError', () => {
  const response = new Response('busy', { status: 429, headers: { 'Retry-After': '7' } })
  const error = httpError({
    response,
    text: 'busy',
    url: 'https://img.test/images',
    message: 'Rate limited',
    requestBodyValues: { prompt: 'p' },
  })

  it('keeps the status, headers, body and request', () => {
    expect(APICallError.isInstance(error)).toBe(true)
    expect(error).toMatchObject({
      message: 'Rate limited',
      statusCode: 429,
      responseBody: 'busy',
      url: 'https://img.test/images',
      requestBodyValues: { prompt: 'p' },
    })
    expect(error.responseHeaders).toMatchObject({ 'retry-after': '7' })
  })

  it('is never retryable by itself, so a 429 is retried only by the middleware', () => {
    expect(error.isRetryable).toBe(false)
  })
})

describe('definedHeaders', () => {
  it('drops the headers the SDK left undefined', () => {
    expect(definedHeaders({ a: '1', b: undefined })).toEqual({ a: '1' })
    expect(definedHeaders(undefined)).toEqual({})
  })
})

describe('unsupportedInputWarnings', () => {
  it('warns for an aspect ratio and a mask, and for nothing else', () => {
    const mask = { type: 'file' as const, mediaType: 'image/png', data: PNG }
    expect(unsupportedInputWarnings({ aspectRatio: '16:9', mask })).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'aspectRatio' }),
      expect.objectContaining({ type: 'unsupported', feature: 'mask' }),
    ])
    expect(unsupportedInputWarnings({ aspectRatio: undefined, mask: undefined })).toEqual([])
  })
})

describe('reference files', () => {
  const file = (data: string | Uint8Array): ReferenceFile => ({
    type: 'file',
    mediaType: 'image/png',
    data,
  })

  it('refuses a URL and names the provider', () => {
    expect(() => inlineFile({ type: 'url', url: 'https://img.test/a.png' }, 'NanoGPT')).toThrow(
      'NanoGPT image references must be base64.',
    )
  })

  it('passes a file through', () => {
    const ref = file(PNG)
    expect(inlineFile(ref, 'NanoGPT')).toBe(ref)
  })

  it('reads base64 and bytes alike', () => {
    const bytes = new Uint8Array([1, 2, 3])
    for (const data of ['AQID', bytes]) {
      const ref = inlineFile(file(data), 'X')
      expect(fileBase64(ref)).toBe('AQID')
      expect(fileBytes(ref)).toEqual(bytes)
    }
  })
})
