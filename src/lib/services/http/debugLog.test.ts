import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { debugLog } from '#lib/stores/debugLog.ts'
import {
  describeReadFailure,
  describeRequestBody,
  logResponse,
  parseLoggedBody,
  readLoggedBody,
  redactHeaders,
  scrubBase64,
  type DebugEntry,
} from './debugLog'

describe('scrubBase64', () => {
  it('replaces long base64 and data URIs', () => {
    expect(scrubBase64('A'.repeat(1024))).toBe('[base64, 1024 chars]')
    expect(scrubBase64('data:image/png;base64,' + 'A'.repeat(1024))).toMatch(
      /^\[base64, \d+ chars\]$/,
    )
  })

  it('leaves short strings, long prose and non-strings alone', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(40)
    expect(scrubBase64('iVBORw0KGgo=')).toBe('iVBORw0KGgo=')
    expect(scrubBase64(prose)).toBe(prose)
    expect(scrubBase64(7)).toBe(7)
    expect(scrubBase64(null)).toBe(null)
  })
})

describe('parseLoggedBody', () => {
  it('parses JSON and scrubs base64 nested in it', () => {
    const text = JSON.stringify({ ok: true, image: { data: 'A'.repeat(2048) } })
    expect(parseLoggedBody(text)).toEqual({ ok: true, image: { data: '[base64, 2048 chars]' } })
  })

  it('falls back to the text, scrubbed, when it is not JSON', () => {
    expect(parseLoggedBody('plain list')).toBe('plain list')
    expect(parseLoggedBody('A'.repeat(2048))).toBe('[base64, 2048 chars]')
  })
})

describe('describeRequestBody', () => {
  it('scrubs nested strings and keeps other values', () => {
    const body = JSON.stringify({ n: 1, ok: true, none: null, list: [{ data: 'A'.repeat(1024) }] })
    expect(describeRequestBody(body)).toEqual({
      n: 1,
      ok: true,
      none: null,
      list: [{ data: '[base64, 1024 chars]' }],
    })
  })

  it('falls back to a raw excerpt for a body that is not JSON', () => {
    expect(describeRequestBody('not json')).toEqual({ raw: 'not json' })
  })

  it('shows the fields of a FormData, with files reduced to name, type and size', () => {
    const form = new FormData()
    form.append('prompt', 'a castle')
    form.append('model', 'flux')
    form.append('image', new File([new Uint8Array(4)], 'ref.png', { type: 'image/png' }))
    expect(describeRequestBody(form)).toEqual({
      formData: { prompt: 'a castle', model: 'flux', image: '[file ref.png, image/png, 4 bytes]' },
    })
  })

  it('keeps a repeated FormData key as an array and scrubs long base64', () => {
    const form = new FormData()
    form.append('image[]', new File([new Uint8Array(1)], 'a.png', { type: 'image/png' }))
    form.append('image[]', new File([new Uint8Array(2)], 'b.png', { type: 'image/png' }))
    form.append('mask', 'A'.repeat(2048))
    expect(describeRequestBody(form)).toEqual({
      formData: {
        'image[]': ['[file a.png, image/png, 1 bytes]', '[file b.png, image/png, 2 bytes]'],
        mask: '[base64, 2048 chars]',
      },
    })
  })

  it('shows an appended Blob as a file named blob', () => {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(3)], { type: 'image/webp' }))
    expect(describeRequestBody(form)).toEqual({
      formData: { image: '[file blob, image/webp, 3 bytes]' },
    })
  })
})

// `controller.error` discards queued chunks, so the failure waits for the second pull.
function failAfter(chunk?: string): ReadableStream<Uint8Array> {
  let pulls = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunk && pulls++ === 0) controller.enqueue(new TextEncoder().encode(chunk))
      else controller.error(new Error('connection lost'))
    },
  })
}

describe('readLoggedBody', () => {
  const failing = (chunk?: string) => new Response(failAfter(chunk))

  const failedRead = async (response: Response) => {
    const read = await readLoggedBody(response)
    if (read.ok) throw new Error('expected the read to fail')
    return read
  }

  it('returns the whole text of a body that finishes', async () => {
    expect(await readLoggedBody(new Response('héllo'))).toEqual({
      ok: true,
      text: 'héllo',
      bytes: 6,
    })
  })

  it('returns the text that arrived before a failure, without throwing', async () => {
    expect(await readLoggedBody(failing('{"partial":'))).toMatchObject({
      ok: false,
      text: '{"partial":',
      bytes: 11,
      error: new Error('connection lost'),
    })
  })

  it('describes how far a failed body got', async () => {
    expect(describeReadFailure(await failedRead(failing()))).toBe(
      'connection lost (headers received, no body yet)',
    )
    expect(describeReadFailure(await failedRead(failing('abc')))).toBe(
      'connection lost (3 bytes received)',
    )
  })
})

describe('redactHeaders', () => {
  it('shortens a key longer than eight characters, whatever the header shape', () => {
    const key = 'sk-1234567890abcdef'
    expect(redactHeaders({ Authorization: key })).toEqual({ Authorization: 'sk-1...cdef' })
    expect(redactHeaders(new Headers({ 'x-api-key': key }))).toEqual({ 'x-api-key': 'sk-1...cdef' })
    expect(redactHeaders([['X-Goog-Api-Key', key]])).toEqual({ 'X-Goog-Api-Key': 'sk-1...cdef' })
  })

  it('masks a short key outright and keeps other headers as sent', () => {
    expect(redactHeaders({ Accept: 'application/json', Authorization: 'short' })).toEqual({
      Accept: 'application/json',
      Authorization: '[MASKED]',
    })
    expect(redactHeaders({ 'x-api-key': 'a'.repeat(16) })).toEqual({ 'x-api-key': '[MASKED]' })
    expect(redactHeaders({ 'x-api-key': 'a'.repeat(17) })).toEqual({ 'x-api-key': 'aaaa...aaaa' })
    expect(redactHeaders(undefined)).toEqual({})
  })
})

describe('logResponse', () => {
  const entry: DebugEntry = { debugId: 'dbg', serviceId: 'svc', startTime: Date.now() }
  const written = () => debugLog.snapshot().map((e) => e.data)

  beforeEach(() => {
    debugLog.reset()
    debugLog.active = true
    debugLog.addRequest('svc', {}, 'dbg')
  })

  afterEach(() => {
    debugLog.active = false
    debugLog.reset()
  })

  it('logs an image by type and size and leaves the body unread', () => {
    const response = new Response(new Uint8Array(4), {
      headers: { 'content-type': 'image/png', 'content-length': '4' },
    })

    logResponse(response, entry)

    expect(written()).toContainEqual({ status: 200, contentType: 'image/png', size: 4 })
    expect(response.bodyUsed).toBe(false)
  })

  it('logs a video by type and size and leaves the body unread', () => {
    const response = new Response(new Uint8Array(4), {
      headers: { 'content-type': 'video/mp4', 'content-length': '4' },
    })

    logResponse(response, entry)

    expect(written()).toContainEqual({ status: 200, contentType: 'video/mp4', size: 4 })
    expect(response.bodyUsed).toBe(false)
  })

  it('logs the status and the reason when a body fails mid-read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error('connection lost')),
    })

    logResponse(new Response(body, { headers: { 'content-type': 'application/json' } }), entry)

    await vi.waitFor(() =>
      expect(written()).toContainEqual({
        status: 200,
        error: 'connection lost (headers received, no body yet)',
        received: { bytes: 0 },
      }),
    )
    expect(debugLog.snapshot().at(-1)?.error).toBe(
      'connection lost (headers received, no body yet)',
    )
  })

  it('keeps the text that arrived before a body failed', async () => {
    logResponse(
      new Response(failAfter('{"a":1'), { headers: { 'content-type': 'application/json' } }),
      entry,
    )

    await vi.waitFor(() =>
      expect(written()).toContainEqual({
        status: 200,
        error: 'connection lost (6 bytes received)',
        received: { bytes: 6, body: '{"a":1' },
      }),
    )
    expect(debugLog.snapshot().at(-1)?.error).toBe('connection lost (6 bytes received)')
  })

  it('logs an untyped body as binary rather than reading it as text', () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    response.headers.delete('content-type')

    logResponse(response, entry)

    expect(written()).toContainEqual({ status: 200, contentType: null, size: undefined })
    expect(response.bodyUsed).toBe(false)
  })

  it('logs a text body as scrubbed text and leaves the caller its own copy', async () => {
    const response = new Response('plain list', { headers: { 'content-type': 'text/plain' } })

    logResponse(response, entry)

    await vi.waitFor(() => expect(written()).toContainEqual({ status: 200, body: 'plain list' }))
    expect(await response.text()).toBe('plain list')
  })

  it('logs an error status with its body', async () => {
    logResponse(new Response('{"error":"bad"}', { status: 400 }), entry)

    await vi.waitFor(() =>
      expect(written()).toContainEqual(
        expect.objectContaining({ status: 400, error: { error: 'bad' } }),
      ),
    )
  })
})
