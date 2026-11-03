import { describe, it, expect } from 'vitest'
import type { ImageProviderType } from '#lib/types/index.ts'
import { normalizeBaseUrl, parseBaseUrl } from '#lib/utils/url.ts'
import { PROVIDER_BASE_URL, resolveBaseUrl } from './baseUrls'

const providerTypes = Object.keys(PROVIDER_BASE_URL) as ImageProviderType[]

describe('PROVIDER_BASE_URL', () => {
  it.each(providerTypes)('%s declares a default that agrees with its mode', (providerType) => {
    const rule = PROVIDER_BASE_URL[providerType]
    if (rule.mode === 'required') expect('default' in rule).toBe(false)
    if (rule.mode === 'optional') expect(rule.default).toBeTruthy()
  })

  it.each(providerTypes)('%s default is a normalized http(s) URL', (providerType) => {
    const { default: url } = PROVIDER_BASE_URL[providerType] as { default?: string }
    if (url === undefined) return
    expect(['http:', 'https:']).toContain(parseBaseUrl(url).protocol)
    expect(normalizeBaseUrl(url)).toBe(url)
  })
})

describe('resolveBaseUrl', () => {
  it.each(providerTypes)('falls back for a blank value on %s', (providerType) => {
    const rule = PROVIDER_BASE_URL[providerType]
    const expected = rule.mode === 'required' ? '' : (rule.default ?? '')
    for (const blank of [undefined, '', '   ', 'https://']) {
      expect(resolveBaseUrl(providerType, blank)).toBe(expected)
    }
  })

  it('returns the normalized value for a real one', () => {
    expect(resolveBaseUrl('openai', ' https://proxy.test/v1// ')).toBe('https://proxy.test/v1')
    expect(resolveBaseUrl('openai-compatible', 'https://proxy.test/v1/')).toBe(
      'https://proxy.test/v1',
    )
  })
})
