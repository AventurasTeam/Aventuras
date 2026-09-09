import { describe, expect, it } from 'vitest'

import { ASSUMED_PROVIDER_MAX_INPUT_TOKENS, embedderInputWindow } from './input-window'
import type { EmbedderConfig } from './types'

const local = (modelId: string): EmbedderConfig => ({ backend: 'local', modelId, dim: 384 })
const provider: EmbedderConfig = {
  backend: 'provider',
  providerId: 'p1',
  modelId: 'text-embedding-3-small',
  dim: null,
  truncation: null,
}

describe('embedderInputWindow', () => {
  it('reads a catalogued local model from the catalog', () => {
    expect(embedderInputWindow(local('Xenova/all-MiniLM-L6-v2'))).toEqual({
      tokens: 512,
      source: 'catalog',
    })
  })

  // A custom import has no catalog row. Inventing a ceiling would warn against a
  // limit nobody set; the embed path still reports what it actually cut.
  it('reports a local model it does not carry as unknown, not as a default', () => {
    expect(embedderInputWindow(local('acme/hand-imported'))).toEqual({
      tokens: null,
      source: 'unknown',
    })
  })

  it('prefers a configured provider limit over the assumption', () => {
    expect(embedderInputWindow(provider, { maxInputTokens: 512 })).toEqual({
      tokens: 512,
      source: 'configured',
    })
  })

  it('falls back to the assumption, and says so', () => {
    expect(embedderInputWindow(provider)).toEqual({ tokens: 8192, source: 'assumed' })
  })

  it('treats capabilities with no limit set the same as no capabilities at all', () => {
    expect(embedderInputWindow(provider, {})).toEqual({ tokens: 8192, source: 'assumed' })
  })

  // The surface has to be able to tell a guess from an answer, so these must not
  // collapse into one label.
  it('never labels an assumption as configured', () => {
    expect(embedderInputWindow(provider).source).not.toBe('configured')
    expect(
      embedderInputWindow(provider, { maxInputTokens: ASSUMED_PROVIDER_MAX_INPUT_TOKENS }),
    ).toEqual({ tokens: 8192, source: 'configured' })
  })
})
