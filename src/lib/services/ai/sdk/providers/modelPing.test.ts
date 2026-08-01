import { describe, it, expect, vi } from 'vitest'

// The module reaches for Tauri's HTTP plugin at import time. None of the pure helpers under
// test go near it, but the import has to resolve for the file to load at all.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

// `./config` pulls in the provider registry, which reaches the debug *rune* store through the
// image fetch adapter. Rune modules cannot be imported by this suite (no SvelteKit plugin, so
// `$state` is undefined), and the helpers under test never touch it -- see the README's note
// on why services mock stores rather than the suite gaining a Svelte compiler.
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { isActive: false, addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

const { extractQuotaPercent, normalizeBaseUrl, getEffectiveBaseUrl } = await import('./modelPing')

/**
 * The health dots in the model picker are read as fact -- a green one means "this key works
 * and has quota". Both helpers here feed that, and both fail quietly: a base URL that keeps
 * its trailing slash produces a `//chat/completions` some gateways 404, and a quota header
 * read from the wrong pair of names shows full quota on an exhausted key.
 */

function headers(pairs: Record<string, string>): Headers {
  return new Headers(pairs)
}

describe('normalizeBaseUrl', () => {
  it('strips a trailing slash', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
  })

  it('strips several trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1')
  })

  it('trims surrounding whitespace, which pasted keys and URLs carry', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1  ')).toBe('https://api.example.com/v1')
  })

  it('leaves a URL that needs nothing done to it alone', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1')
  })

  it('never strips the slashes in the scheme', () => {
    expect(normalizeBaseUrl('https://')).toBe('https:')
  })
})

describe('getEffectiveBaseUrl', () => {
  it("prefers the profile's own base URL", () => {
    const url = getEffectiveBaseUrl({
      providerType: 'openrouter',
      baseUrl: 'https://custom.example.com/v1/',
    } as never)
    expect(url).toBe('https://custom.example.com/v1')
  })

  it("falls back to the provider's default when the profile has none", () => {
    const url = getEffectiveBaseUrl({ providerType: 'openrouter', baseUrl: '' } as never)
    expect(url).toContain('openrouter')
    expect(url.endsWith('/')).toBe(false)
  })

  it('treats a whitespace-only base URL as absent', () => {
    const fromBlank = getEffectiveBaseUrl({ providerType: 'openrouter', baseUrl: '   ' } as never)
    const fromMissing = getEffectiveBaseUrl({ providerType: 'openrouter' } as never)
    expect(fromBlank).toBe(fromMissing)
  })

  it('returns an empty string for a provider with no default endpoint', () => {
    // `openai-compatible` has no baseUrl of its own -- it exists to be pointed somewhere.
    // An empty string is the signal the caller checks; a `undefined/chat/completions` is not.
    expect(getEffectiveBaseUrl({ providerType: 'openai-compatible' } as never)).toBe('')
  })
})

describe('extractQuotaPercent', () => {
  it('reads the plain x-ratelimit pair', () => {
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '50', 'x-ratelimit-limit': '100' })),
    ).toBe(50)
  })

  it('reads the -requests suffixed pair', () => {
    expect(
      extractQuotaPercent(
        headers({ 'x-ratelimit-remaining-requests': '1', 'x-ratelimit-limit-requests': '4' }),
      ),
    ).toBe(25)
  })

  it('reads the unprefixed ratelimit pair', () => {
    expect(
      extractQuotaPercent(headers({ 'ratelimit-remaining': '3', 'ratelimit-limit': '4' })),
    ).toBe(75)
  })

  it('prefers the first variant when a response carries more than one', () => {
    // Order is the contract: providers send overlapping families with different windows, and
    // silently picking whichever happened to parse would make the number unexplainable.
    const result = extractQuotaPercent(
      headers({
        'x-ratelimit-remaining': '100',
        'x-ratelimit-limit': '100',
        'ratelimit-remaining': '0',
        'ratelimit-limit': '100',
      }),
    )
    expect(result).toBe(100)
  })

  it('is case-insensitive about header names', () => {
    expect(
      extractQuotaPercent(headers({ 'X-RateLimit-Remaining': '10', 'X-RateLimit-Limit': '20' })),
    ).toBe(50)
  })

  it('rounds to a whole percent', () => {
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '1', 'x-ratelimit-limit': '3' })),
    ).toBe(33)
  })

  it('reports zero rather than nothing on an exhausted quota', () => {
    // The distinction matters at the UI: 0 is a red dot, null is no dot at all.
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '100' })),
    ).toBe(0)
  })

  it('clamps a remaining count above the limit to 100', () => {
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '150', 'x-ratelimit-limit': '100' })),
    ).toBe(100)
  })

  it('clamps a negative remaining count to 0', () => {
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '-5', 'x-ratelimit-limit': '100' })),
    ).toBe(0)
  })

  it('returns null when no quota headers are present', () => {
    expect(extractQuotaPercent(headers({ 'content-type': 'application/json' }))).toBeNull()
  })

  it('returns null when only one half of a pair is present', () => {
    expect(extractQuotaPercent(headers({ 'x-ratelimit-remaining': '50' }))).toBeNull()
  })

  it('returns null when a limit of zero would divide by zero', () => {
    expect(
      extractQuotaPercent(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '0' })),
    ).toBeNull()
  })

  it('returns null when the values are not numbers', () => {
    expect(
      extractQuotaPercent(
        headers({ 'x-ratelimit-remaining': 'many', 'x-ratelimit-limit': 'lots' }),
      ),
    ).toBeNull()
  })

  it('falls through to a later variant when an earlier one is unusable', () => {
    const result = extractQuotaPercent(
      headers({
        'x-ratelimit-remaining': 'unknown',
        'x-ratelimit-limit': 'unknown',
        'ratelimit-remaining': '5',
        'ratelimit-limit': '10',
      }),
    )
    expect(result).toBe(50)
  })
})
