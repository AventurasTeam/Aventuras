import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { httpFetch } from './http'

const mockFetch = vi.mocked(tauriHttpFetch)

function sentHeaders() {
  return new Headers(mockFetch.mock.calls[0][1]?.headers)
}

describe('httpFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}'))
  })

  it('adds an empty origin when the caller sets none', async () => {
    await httpFetch('https://api.test/')
    expect(sentHeaders().get('origin')).toBe('')
  })

  it.each([
    ['Origin', { Origin: 'https://app.test' }],
    ['origin', { origin: 'https://app.test' }],
    ['a Headers instance', new Headers({ origin: 'https://app.test' })],
    ['an entries array', [['ORIGIN', 'https://app.test']] as [string, string][]],
  ])("keeps the caller's origin from %s", async (_name, headers) => {
    await httpFetch('https://api.test/', { headers })
    expect(sentHeaders().get('origin')).toBe('https://app.test')
  })

  it('passes other headers and init fields through without mutating the caller', async () => {
    const init = { method: 'POST', headers: { Authorization: 'Bearer k' }, maxRedirections: 0 }

    await httpFetch('https://api.test/', init)

    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'POST', maxRedirections: 0 })
    expect(sentHeaders().get('authorization')).toBe('Bearer k')
    expect(init.headers).toEqual({ Authorization: 'Bearer k' })
  })
})
