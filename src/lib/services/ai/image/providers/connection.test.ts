import { describe, expect, it } from 'vitest'
import type { ImageProviderConnection, ImageProviderType } from '#lib/types/index.ts'
import { imageConnectionFor, isImageProviderType, modelListKey } from './connection'

describe('imageConnectionFor', () => {
  it.each([
    ['nanogpt', 'key', 'https://partner.test', { apiKey: 'key', baseUrl: 'https://partner.test' }],
    ['openrouter', 'key', 'https://stale.test', { apiKey: 'key', baseUrl: undefined }],
    ['a1111', 'stale-key', 'http://sd.test', { apiKey: '', baseUrl: 'http://sd.test' }],
    ['comfyui', 'stale-key', 'http://comfy.test', { apiKey: '', baseUrl: 'http://comfy.test' }],
    [
      'openai-compatible',
      'key',
      'https://proxy.test',
      { apiKey: 'key', baseUrl: 'https://proxy.test' },
    ],
  ] satisfies [
    ImageProviderType,
    string,
    string,
    Pick<ImageProviderConnection, 'apiKey' | 'baseUrl'>,
  ][])(
    '%s keeps only the fields the provider has an input for',
    (providerType, apiKey, baseUrl, expected) => {
      expect(imageConnectionFor(providerType, apiKey, baseUrl)).toMatchObject({
        providerType,
        ...expected,
      })
    },
  )

  it('sets baseUrl even when the provider takes none, so a merge overwrites a stale one', () => {
    expect(imageConnectionFor('openrouter', 'key', 'https://stale.test')).toHaveProperty(
      'baseUrl',
      undefined,
    )
  })
})

describe('modelListKey', () => {
  const key = modelListKey(imageConnectionFor('openai-compatible', 'k', 'https://x.example/v1'))

  it('is the same for another spelling of the base URL', () => {
    const other = imageConnectionFor('openai-compatible', 'k', 'https://x.example/v1/')
    expect(modelListKey(other)).toBe(key)
  })

  it.each([
    ['provider', imageConnectionFor('nanogpt', 'k', 'https://x.example/v1')],
    ['API key', imageConnectionFor('openai-compatible', 'k2', 'https://x.example/v1')],
    ['base URL', imageConnectionFor('openai-compatible', 'k', 'https://y.example/v1')],
  ])('differs when the %s differs', (_, other) => {
    expect(modelListKey(other)).not.toBe(key)
  })
})

describe('isImageProviderType', () => {
  it('accepts a provider this build knows and rejects any other string', () => {
    expect(isImageProviderType('openrouter')).toBe(true)
    expect(isImageProviderType('chutes')).toBe(false)
    expect(isImageProviderType('toString')).toBe(false)
  })
})
