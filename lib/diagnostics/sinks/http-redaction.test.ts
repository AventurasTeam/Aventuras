import { afterEach, describe, expect, it } from 'vitest'

import {
  redactHeaderValue,
  redactHeaders,
  redactResponseHeaders,
  redactUrl,
  setHttpCallKnownSecretValues,
} from './http-redaction'

describe('http redaction', () => {
  afterEach(() => setHttpCallKnownSecretValues([]))

  it('redacts exact secret values and common auth prefixes', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])

    expect(redactHeaderValue('sk-test-abc')).toBe('***')
    expect(redactHeaderValue('Bearer sk-test-abc')).toBe('***')
    expect(redactHeaderValue('bearer sk-test-abc')).toBe('***')
    expect(redactHeaderValue('BEARER sk-test-abc')).toBe('***')
    expect(redactHeaderValue('Basic sk-test-abc')).toBe('***')
    expect(redactHeaderValue('Token sk-test-abc')).toBe('***')
    expect(redactHeaderValue('application/json')).toBe('application/json')
  })

  it('does not substring-match short local-server keys', () => {
    setHttpCallKnownSecretValues(['123'])

    expect(redactHeaderValue('Bearer 123')).toBe('***')
    expect(redactHeaderValue('12345')).toBe('12345')
    expect(redactHeaderValue('req-123-abc')).toBe('req-123-abc')
  })

  it('redacts arbitrary request header names by value', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])

    expect(
      redactHeaders({
        authorization: 'Bearer sk-test-abc',
        'x-corp-grant': 'sk-test-abc',
        'content-type': 'application/json',
      }),
    ).toEqual({
      authorization: '***',
      'x-corp-grant': '***',
      'content-type': 'application/json',
    })
  })

  it('redacts response headers but preserves provider set-cookie values', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])

    expect(
      redactResponseHeaders({
        'x-echo': 'sk-test-abc',
        'set-cookie': 'sk-test-abc',
      }),
    ).toEqual({
      'x-echo': '***',
      'set-cookie': 'sk-test-abc',
    })
  })

  it('refreshes the comparator on key rotation: new key matches, old key no longer does', () => {
    setHttpCallKnownSecretValues(['sk-old-key'])
    expect(redactHeaderValue('Bearer sk-old-key')).toBe('***')

    setHttpCallKnownSecretValues(['sk-new-key'])
    expect(redactHeaderValue('Bearer sk-new-key')).toBe('***')
    expect(redactHeaderValue('Bearer sk-old-key')).toBe('Bearer sk-old-key')
    expect(redactUrl('/r?token=sk-old-key')).toBe('/r?token=sk-old-key')
  })

  it('redacts query string values by exact match', () => {
    setHttpCallKnownSecretValues(['sk-test-abc', '123'])

    expect(redactUrl('https://example.test/path?api_key=sk-test-abc&n=12345')).toBe(
      'https://example.test/path?api_key=***&n=12345',
    )
    expect(redactUrl('/relative?token=123')).toBe('/relative?token=***')

    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrl('https://example.test/?token=Bearer sk-test-abc')).toBe(
      'https://example.test/?token=Bearer sk-test-abc',
    )
    expect(redactUrl('https://example.test/?token=sk-test-abc&token=public&x=1')).toBe(
      'https://example.test/?token=***&token=public&x=1',
    )
  })

  it('redacts an OAI-compat key across header placements by value', () => {
    setHttpCallKnownSecretValues(['sk-oai-compat-xyz'])

    expect(redactHeaderValue('Bearer sk-oai-compat-xyz')).toBe('***')
    expect(
      redactHeaders({
        authorization: 'Bearer sk-oai-compat-xyz',
        'api-key': 'sk-oai-compat-xyz',
        'content-type': 'application/json',
      }),
    ).toEqual({ authorization: '***', 'api-key': '***', 'content-type': 'application/json' })
  })

  it('redacts an OAI-compat key placed in the query string', () => {
    setHttpCallKnownSecretValues(['sk-oai-compat-xyz'])
    expect(redactUrl('http://localhost:1234/v1/models?api_key=sk-oai-compat-xyz')).toBe(
      'http://localhost:1234/v1/models?api_key=***',
    )
  })
})
