import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFetchWithCapture } from './fetch'

const expoFetch = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response('{}')),
  ),
)

const sink = vi.hoisted(() => ({
  beginCall: vi.fn(() => 'call-1'),
  completeCall: vi.fn(),
  failCall: vi.fn(),
}))

vi.mock('expo/fetch', () => ({ fetch: expoFetch }))
vi.mock('./platform-fetch', () => import('./platform-fetch.native'))
vi.mock('@/lib/diagnostics', () => ({ httpCallSink: sink }))

const CHAT_URL = 'http://10.0.2.2:4319/v1/chat/completions'

// React Native's global Request is whatwg-fetch's, which defines no `body`
// property: it reads undefined, never null, even on a GET.
class WhatwgShapedRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init)
    Object.defineProperty(this, 'body', { value: undefined })
  }
}

describe('createFetchWithCapture over the native transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('Request', WhatwgShapedRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['GET', 'HEAD'])('sends and captures a %s without a body', async (method) => {
    await createFetchWithCapture({ source: 'unit-test' })('http://10.0.2.2:4319/v1/models', {
      method,
    })

    expect(expoFetch).toHaveBeenCalledOnce()
    expect(expoFetch.mock.calls[0]?.[1]?.body ?? null).toBeNull()
    expect(sink.beginCall).toHaveBeenCalledWith(
      expect.objectContaining({ method, requestBody: undefined }),
    )
  })

  function expectPostBodyCapturedAndSent() {
    expect(sink.beginCall).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', requestBody: 'hello' }),
    )
    expect(expoFetch.mock.calls[0]?.[1]?.body).toBe('hello')
  }

  it('still captures and sends a POST body passed in init', async () => {
    await createFetchWithCapture({ source: 'unit-test' })(CHAT_URL, {
      method: 'POST',
      body: 'hello',
    })

    expectPostBodyCapturedAndSent()
  })

  it('still captures and sends a POST body carried by a Request', async () => {
    await createFetchWithCapture({ source: 'unit-test' })(
      new WhatwgShapedRequest(CHAT_URL, { method: 'POST', body: 'hello' }),
    )

    expectPostBodyCapturedAndSent()
  })
})
