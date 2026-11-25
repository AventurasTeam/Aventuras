import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { debugLog } from '#lib/stores/debugLog.ts'
import { corsFetch } from './utils'

const mockFetch = vi.mocked(tauriHttpFetch)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue(
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  )
  debugLog.reset()
  debugLog.active = true
})

afterEach(() => {
  debugLog.active = false
  debugLog.reset()
})

describe('corsFetch', () => {
  it('logs nothing unless asked to', async () => {
    await corsFetch('https://site.test/api')

    expect(debugLog.snapshot()).toEqual([])
  })

  it('logs the request and response under the given service', async () => {
    await corsFetch('https://site.test/api', { debug: { serviceId: 'discovery' } })

    await vi.waitFor(() => expect(debugLog.count).toBe(2))
    expect(debugLog.snapshot().map((e) => [e.type, e.serviceName])).toEqual([
      ['request', 'discovery'],
      ['response', 'discovery'],
    ])
  })

  it('keeps the debug option away from the plugin and sends the browser user agent', async () => {
    await corsFetch('https://site.test/api', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      debug: { serviceId: 'discovery' },
    })

    const init = mockFetch.mock.calls[0][1]
    expect(init).not.toHaveProperty('debug')
    expect(init).toMatchObject({ method: 'POST' })
    const headers = new Headers(init?.headers)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('user-agent')).toMatch(/^Mozilla\//)
  })
})
