import { afterEach, describe, expect, it } from 'vitest'

import {
  redactHeaderValue,
  redactHeaders,
  redactKnownSecretSubstrings,
  redactResponseHeaders,
  redactSecretsInText,
  redactUrl,
  redactUrlsInText,
  setHttpCallKnownSecretValues,
} from './http-redaction'

// A hosted-provider-length key, well above the substring scan's floor;
// used wherever a test wants a secret whose length isn't the point.
const REALISTIC_SECRET = 'sk-realistic-secret-1234567890'

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

  it('redacts a secret placed in URL userinfo, independent of the query string', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrl('https://sk-test-abc@host.test/v1')).toBe('https://***@host.test/v1')
    expect(redactUrl('https://user:sk-test-abc@host.test/v1')).toBe('https://user:***@host.test/v1')
  })

  it('redacts both userinfo and a query param carrying the same secret', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrl('https://user:sk-test-abc@host.test/v1?api_key=sk-test-abc')).toBe(
      'https://user:***@host.test/v1?api_key=***',
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

  it('redacts a keyed URL embedded in free text, leaving the rest untouched', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    const text =
      'TypeError: fetch failed\n    at https://api.example.test/v1?api_key=sk-test-abc (native)'
    expect(redactUrlsInText(text)).toBe(
      'TypeError: fetch failed\n    at https://api.example.test/v1?api_key=*** (native)',
    )
  })

  it('only touches an embedded URL query-param value, never its path', () => {
    setHttpCallKnownSecretValues(['123'])
    const text = 'GET https://api.example.test/v1/items/123?page=1 failed'
    expect(redactUrlsInText(text)).toBe(text)
  })

  it('does not throw on a URL-shaped substring that fails to parse', () => {
    const text = 'see https://[not-a-valid-host for details'
    expect(() => redactUrlsInText(text)).not.toThrow()
  })

  it('redacts a keyed URL followed by ordinary trailing punctuation', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrlsInText('for https://a.test/v1?api_key=sk-test-abc: Unauthorized')).toBe(
      'for https://a.test/v1?api_key=***: Unauthorized',
    )
    expect(redactUrlsInText('see https://a.test/v1?api_key=sk-test-abc.')).toBe(
      'see https://a.test/v1?api_key=***.',
    )
    expect(redactUrlsInText('(https://a.test/v1?api_key=sk-test-abc)')).toBe(
      '(https://a.test/v1?api_key=***)',
    )
  })

  it('redacts the same secret consistently whether or not it is followed by punctuation', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    const text =
      'tried https://a.test/v1?api_key=sk-test-abc, https://b.test/v1?api_key=sk-test-abc'
    expect(redactUrlsInText(text)).toBe(
      'tried https://a.test/v1?api_key=***, https://b.test/v1?api_key=***',
    )
  })

  it('matches an uppercase URL scheme (redactUrl normalizes it to lowercase on rewrite)', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrlsInText('at HTTPS://a.test/v1?api_key=sk-test-abc')).toBe(
      'at https://a.test/v1?api_key=***',
    )
  })

  it('strips a V8 stack-frame line:col suffix before matching the query value', () => {
    setHttpCallKnownSecretValues(['sk-test-abc'])
    expect(redactUrlsInText('at https://a.test/v1?api_key=sk-test-abc:12:9')).toBe(
      'at https://a.test/v1?api_key=***:12:9',
    )
  })

  it('substring scan floor: a 5-char secret is not redacted, a 6-char secret is', () => {
    setHttpCallKnownSecretValues(['abcde'])
    expect(redactKnownSecretSubstrings('Bearer abcde')).toBe('Bearer abcde')

    setHttpCallKnownSecretValues(['abcdef'])
    expect(redactKnownSecretSubstrings('Bearer abcdef')).toBe('Bearer ***')
  })

  it('substring scan still ignores the 3-char local-server key from the header-redaction case', () => {
    setHttpCallKnownSecretValues(['123'])
    const text = 'Error: 401 Unauthorized: Bearer 123'
    expect(redactKnownSecretSubstrings(text)).toBe(text)
  })

  it('redacts real local-provider key shapes as bare text (a header dump, a provider-config echo)', () => {
    setHttpCallKnownSecretValues(['ollama'])
    expect(redactKnownSecretSubstrings('401 Unauthorized {"authorization":"Bearer ollama"}')).toBe(
      '401 Unauthorized {"authorization":"Bearer ***"}',
    )

    setHttpCallKnownSecretValues(['lm-studio'])
    expect(
      redactKnownSecretSubstrings(
        '{"id":"prov_local","type":"openai-compatible","apiKey":"lm-studio"}',
      ),
    ).toBe('{"id":"prov_local","type":"openai-compatible","apiKey":"***"}')

    setHttpCallKnownSecretValues(['token-abc123'])
    expect(redactKnownSecretSubstrings('Authorization: Bearer token-abc123')).toBe(
      'Authorization: Bearer ***',
    )
  })

  it('redacts the longest matching secret first, so a shorter prefix cannot leave a partial leak', () => {
    const shortSecret = 'sk-short12'
    const longSecret = `${shortSecret}KLMNOPQRST`
    setHttpCallKnownSecretValues([shortSecret, longSecret])
    expect(redactKnownSecretSubstrings(`Bearer ${longSecret}`)).toBe('Bearer ***')
  })

  it('does not hang on a huge trailing-punctuation run (bounded scan, not a full backtracking search)', () => {
    const text = `https://a.test/v1?x=${':'.repeat(200000)}X`
    const start = Date.now()
    redactUrlsInText(text)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('substring scan redacts a realistic-length secret wherever it appears as bare text', () => {
    setHttpCallKnownSecretValues([REALISTIC_SECRET])
    expect(redactKnownSecretSubstrings(`Error: 401 Unauthorized: Bearer ${REALISTIC_SECRET}`)).toBe(
      'Error: 401 Unauthorized: Bearer ***',
    )
    expect(redactKnownSecretSubstrings(`headers: {"authorization":"${REALISTIC_SECRET}"}`)).toBe(
      'headers: {"authorization":"***"}',
    )
  })

  it('redactSecretsInText composes the URL pass and the substring pass', () => {
    setHttpCallKnownSecretValues([REALISTIC_SECRET])
    // ';' doesn't terminate a query string, so the URL pass swallows the whole tail
    // into the param value and fails exact-match — only the substring pass catches it.
    const text = `Error: url=https://a.test/v1?api_key=${REALISTIC_SECRET};status=401`
    expect(redactSecretsInText(text)).toBe('Error: url=https://a.test/v1?api_key=***;status=401')
  })
})
