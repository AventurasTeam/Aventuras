import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFetchWithCapture } from './fetch'

const sink = vi.hoisted(() => ({
  beginCall: vi.fn(() => 'call-1'),
  completeCall: vi.fn(),
  failCall: vi.fn(),
}))

vi.mock('@/lib/diagnostics', () => ({ httpCallSink: sink }))

describe('createFetchWithCapture', () => {
  beforeEach(() => {
    sink.beginCall.mockClear()
    sink.completeCall.mockClear()
    sink.failCall.mockClear()
  })

  it('captures non-streaming responses without consuming returned body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const wrappedFetch = createFetchWithCapture({
      source: 'unit-test',
      fetchImpl,
      actionId: 'action-1',
    })

    const response = await wrappedFetch('https://example.test/v1/chat', {
      method: 'POST',
      headers: { 'x-test': '1' },
      body: 'hello',
    })

    expect(sink.beginCall).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.test/v1/chat',
      requestHeaders: { 'content-type': 'text/plain;charset=UTF-8', 'x-test': '1' },
      requestBody: 'hello',
      source: 'unit-test',
      actionId: 'action-1',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sink.completeCall).toHaveBeenCalledWith('call-1', {
      status: 200,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"ok":true}',
      streamed: false,
    })
    expect(await response.text()).toBe('{"ok":true}')
    expect(sink.failCall).not.toHaveBeenCalled()
  })

  it('captures request metadata and body from Request input', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )
    const wrappedFetch = createFetchWithCapture({
      source: 'unit-test',
      fetchImpl,
    })
    const request = new Request('https://example.test/v1/request', {
      method: 'PUT',
      headers: { 'x-request': 'yes' },
      body: 'request-body',
    })

    const response = await wrappedFetch(request)

    expect(sink.beginCall).toHaveBeenCalledWith({
      method: 'PUT',
      url: 'https://example.test/v1/request',
      requestHeaders: { 'content-type': 'text/plain;charset=UTF-8', 'x-request': 'yes' },
      requestBody: 'request-body',
      source: 'unit-test',
    })
    expect(await response.text()).toBe('ok')
  })

  it('fails call and rethrows when fetch throws', async () => {
    const error = new Error('network down')
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error)
    const wrappedFetch = createFetchWithCapture({
      source: 'unit-test',
      fetchImpl,
    })

    await expect(wrappedFetch('https://example.test/v1/chat')).rejects.toThrow('network down')
    expect(sink.failCall).toHaveBeenCalledWith('call-1', 'Error: network down')
    expect(sink.completeCall).not.toHaveBeenCalled()
  })

  it('tees event-stream responses and completes asynchronously with concatenated body', async () => {
    let resolveStream: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\n'))
        resolveStream = () => {
          controller.enqueue(new TextEncoder().encode('data: two\n\n'))
          controller.close()
        }
      },
    })
    const originalResponse = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(originalResponse)
    const wrappedFetch = createFetchWithCapture({
      source: 'unit-test',
      fetchImpl,
    })

    const response = await wrappedFetch('https://example.test/v1/stream')

    expect(response).toBe(originalResponse)
    expect(sink.completeCall).not.toHaveBeenCalled()
    resolveStream?.()
    await vi.waitFor(() => {
      expect(sink.completeCall).toHaveBeenCalledWith('call-1', {
        status: 200,
        responseHeaders: { 'content-type': 'text/event-stream; charset=utf-8' },
        responseBody: 'data: one\n\ndata: two\n\n',
        streamed: true,
      })
    })
    expect(await response.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('fails call when capture-side stream reading errors', async () => {
    const streamError = new Error('stream exploded')
    let errorStream: (() => void) | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\n'))
        errorStream = () => controller.error(streamError)
      },
    })
    const originalResponse = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(originalResponse)
    const wrappedFetch = createFetchWithCapture({
      source: 'unit-test',
      fetchImpl,
    })

    const response = await wrappedFetch('https://example.test/v1/stream')
    expect(response).toBe(originalResponse)
    errorStream?.()

    await vi.waitFor(() => {
      expect(sink.failCall).toHaveBeenCalledWith('call-1', 'Error: stream exploded')
    })
  })
  // expo/fetch's FetchResponse.clone() throws 'Not implemented'. These two cover
  // the native transport's shape without needing the native bundle.
  describe('when the response cannot be cloned', () => {
    function uncloneable(body: BodyInit | null, headers: Record<string, string>): Response {
      const response = new Response(body, { status: 200, headers })
      Object.defineProperty(response, 'clone', {
        value: () => {
          throw new Error('Not implemented')
        },
      })
      return response
    }

    it('captures an event stream without its body and leaves the stream to the caller', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: one\n\n'))
          controller.close()
        },
      })
      const originalResponse = uncloneable(stream, {
        'content-type': 'text/event-stream',
      })
      const wrappedFetch = createFetchWithCapture({
        source: 'unit-test',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(originalResponse),
      })

      const response = await wrappedFetch('https://example.test/v1/stream')

      expect(response).toBe(originalResponse)
      expect(sink.completeCall).toHaveBeenCalledWith('call-1', {
        status: 200,
        responseHeaders: { 'content-type': 'text/event-stream' },
        streamed: true,
      })
      expect(sink.failCall).not.toHaveBeenCalled()
      // The point of skipping capture: the SDK still gets a readable stream.
      expect(await response.text()).toBe('data: one\n\n')
    })

    it('rebuilds a non-streaming response so the body is still readable', async () => {
      const wrappedFetch = createFetchWithCapture({
        source: 'unit-test',
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(uncloneable('{"ok":true}', { 'content-type': 'application/json' })),
      })

      const response = await wrappedFetch('https://example.test/v1/embeddings')

      expect(sink.completeCall).toHaveBeenCalledWith('call-1', {
        status: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"ok":true}',
        streamed: false,
      })
      expect(await response.json()).toEqual({ ok: true })
    })
  })
})
