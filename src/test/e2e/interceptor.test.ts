import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FetchInterceptor, respondWithStream, respondWithJSON } from './utils/FetchInterceptor'

// vi.hoisted() runs before all imports, creating a stable shared reference
// that the hoisted vi.mock factory can close over without needing to import.
const interceptorRef = vi.hoisted(() => ({ current: null as FetchInterceptor | null }))

// This vi.mock must be at top level (hoisted)
vi.mock('$lib/services/ai/sdk/providers/fetch', () => {
  return {
    createTimeoutFetch: (
      timeout: number,
      serviceId: string,
      manualBody?: string,
      debugId?: string,
    ) => {
      return (
        interceptorRef.current?.createFetchForService(serviceId) ??
        ((..._args: unknown[]) => Promise.reject(new Error('No interceptor installed')))
      )
    },
  }
})

describe('FetchInterceptor', () => {
  let interceptor: FetchInterceptor

  beforeEach(() => {
    interceptor = new FetchInterceptor()
    interceptorRef.current = interceptor
  })

  afterEach(() => {
    interceptor.restore()
    interceptorRef.current = null
  })

  it('captures requests tagged by serviceId', async () => {
    interceptor.on('narrative', respondWithStream('Hello world')).install()

    const { createTimeoutFetch } = await import('$lib/services/ai/sdk/providers/fetch')
    const fetchFn = createTimeoutFetch(30000, 'narrative')
    await fetchFn('https://api.example.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    })

    const req = interceptor.getRequest('narrative')
    expect(req).toBeDefined()
    expect(req.body.messages[0].content).toBe('test')
  })

  it('respondWithStream returns valid SSE response', async () => {
    interceptor.on('narrative', respondWithStream('The dragon appears.')).install()

    const { createTimeoutFetch } = await import('$lib/services/ai/sdk/providers/fetch')
    const fetchFn = createTimeoutFetch(30000, 'narrative')
    const response = await fetchFn('https://api.example.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [], stream: true }),
    })

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('data:')
    expect(text).toContain('[DONE]')
  })

  it('respondWithJSON returns valid JSON response', async () => {
    const data = { scene: { currentLocationName: 'Cave' }, entryUpdates: {} }
    interceptor.on('classifier', respondWithJSON(data)).install()

    const { createTimeoutFetch } = await import('$lib/services/ai/sdk/providers/fetch')
    const fetchFn = createTimeoutFetch(30000, 'classifier')
    const response = await fetchFn('https://api.example.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [] }),
    })

    const json = await response.json()
    expect(json.choices[0].message.content).toContain('Cave')
  })

  it('getRequests returns all requests for a serviceId', async () => {
    interceptor.on('narrative', respondWithStream('chunk')).install()

    const { createTimeoutFetch } = await import('$lib/services/ai/sdk/providers/fetch')
    const fetchFn = createTimeoutFetch(30000, 'narrative')
    await fetchFn('https://a.com', { method: 'POST', body: '{"messages":[]}' })
    await fetchFn('https://a.com', { method: 'POST', body: '{"messages":[]}' })

    expect(interceptor.getRequests('narrative')).toHaveLength(2)
  })

  it('unmatched serviceId falls through with a clear error', async () => {
    interceptor.on('narrative', respondWithStream('ok')).install()

    const { createTimeoutFetch } = await import('$lib/services/ai/sdk/providers/fetch')
    const fetchFn = createTimeoutFetch(30000, 'unknown-service')
    const response = await fetchFn('https://a.com', { method: 'POST', body: '{}' })

    expect(response.status).toBe(404)
  })
})
