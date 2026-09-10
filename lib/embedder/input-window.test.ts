import { describe, expect, it } from 'vitest'

import {
  ASSUMED_PROVIDER_MAX_INPUT_TOKENS,
  embedderInputWindow,
  inputPressure,
} from './input-window'
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

  // A custom import has no catalog row; inventing a ceiling warns against a limit nobody set.
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

  // The surface must tell a guess from an answer, so these two labels can't collapse.
  it('never labels an assumption as configured', () => {
    expect(embedderInputWindow(provider).source).not.toBe('configured')
    expect(
      embedderInputWindow(provider, { maxInputTokens: ASSUMED_PROVIDER_MAX_INPUT_TOKENS }),
    ).toEqual({ tokens: 8192, source: 'configured' })
  })
})

describe('inputPressure', () => {
  const window = (tokens: number | null) => ({ tokens, source: 'catalog' as const })

  it('stays quiet well under the window', () => {
    expect(inputPressure(100, window(512))).toBe('ok')
  })

  it('turns near at three quarters', () => {
    expect(inputPressure(384, window(512))).toBe('near')
  })

  it('is still quiet one token below three quarters', () => {
    expect(inputPressure(383, window(512))).toBe('ok')
  })

  it('is near, not over, exactly on the window', () => {
    expect(inputPressure(512, window(512))).toBe('near')
  })

  it('turns over one token past the window', () => {
    expect(inputPressure(513, window(512))).toBe('over')
  })

  // A custom import establishes no ceiling, and the embed reports a real cut anyway.
  it('stays quiet when the window is unknown, however long the text', () => {
    expect(inputPressure(99_999, { tokens: null, source: 'unknown' })).toBe('ok')
  })
})
