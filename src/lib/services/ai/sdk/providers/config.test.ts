import { describe, it, expect, vi } from 'vitest'

// `./config` is a plain constants module, but the barrel it sits in reaches the debug *rune*
// store through the image fetch adapter; see modelPing.test.ts.
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { isActive: false, addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

const { PROVIDERS } = await import('./config')
const { normalizeBaseUrl } = await import('#lib/utils/url.ts')

// Runtime code takes these as given instead of normalizing them, so a malformed entry has to
// fail here.
describe('PROVIDERS base URLs', () => {
  const withEndpoint = Object.entries(PROVIDERS).filter(([, provider]) => provider.baseUrl !== '')

  it.each(withEndpoint)('%s is a normalized http(s) URL', (_id, provider) => {
    expect(normalizeBaseUrl(provider.baseUrl)).toBe(provider.baseUrl)
    expect(['http:', 'https:']).toContain(new URL(provider.baseUrl).protocol)
  })
})
