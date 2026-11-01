import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageProfile } from '#lib/types/index.ts'
import {
  IMAGE_MODEL_SNAPSHOT_VERSION,
  chooseModelSnapshot,
  modelListKey,
  snapshotModel,
} from './modelSnapshot'
import type { ImageModelInfo } from './types'

const info = (over: Partial<ImageModelInfo> = {}): ImageModelInfo => ({
  id: 'm1',
  name: 'Model One',
  inputModalities: ['text'],
  supportsImg2Img: true,
  maxReferenceImages: 3,
  supportedResolutions: ['1k', '2k'],
  supportedAspectRatios: ['1:1', '16:9'],
  ...over,
})

const stored = (over: Partial<ImageProfile> = {}): ImageProfile => ({
  id: 'p1',
  name: 'p',
  providerType: 'nanogpt',
  apiKey: 'k',
  model: 'm1',
  providerOptions: {},
  createdAt: 1,
  modelSnapshot: snapshotModel('m1', info()),
  ...over,
})

describe('snapshotModel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps capabilities and drops catalogue fields', () => {
    const snap = snapshotModel('m1', info())
    expect(snap).toEqual({
      model: 'm1',
      version: IMAGE_MODEL_SNAPSHOT_VERSION,
      capturedAt: 1_700_000_000_000,
      capabilities: {
        supportsImg2Img: true,
        maxReferenceImages: 3,
        supportedResolutions: ['1k', '2k'],
        supportedAspectRatios: ['1:1', '16:9'],
      },
    })
    expect(snap.capabilities).not.toHaveProperty('name')
  })

  it('shares no arrays with the source', () => {
    const source = info({
      referenceConstraints: { maxBytes: 10, mimeTypes: ['image/png'] },
    })
    const snap = snapshotModel('m1', source)
    source.supportedResolutions?.push('4k')
    source.referenceConstraints?.mimeTypes?.push('image/webp')
    expect(snap.capabilities.supportedResolutions).toEqual(['1k', '2k'])
    expect(snap.capabilities.referenceConstraints?.mimeTypes).toEqual(['image/png'])
  })

  it('is empty for a model the list does not know', () => {
    expect(snapshotModel('gone').capabilities).toEqual({})
  })
})

describe('modelListKey', () => {
  const key = modelListKey('openai-compatible', 'k', 'https://x.example/v1')

  it('is the same for another spelling of the base URL', () => {
    expect(modelListKey('openai-compatible', 'k', 'https://x.example/v1/')).toBe(key)
  })

  it.each([
    ['provider', modelListKey('nanogpt', 'k', 'https://x.example/v1')],
    ['API key', modelListKey('openai-compatible', 'k2', 'https://x.example/v1')],
    ['base URL', modelListKey('openai-compatible', 'k', 'https://y.example/v1')],
  ])('differs when the %s differs', (_, other) => {
    expect(other).not.toBe(key)
  })
})

describe('chooseModelSnapshot', () => {
  const base = {
    model: 'm1',
    providerType: 'nanogpt' as const,
    baseUrl: undefined,
    models: [info()],
    settled: true,
    stored: stored(),
  }

  it('captures a listed model from a settled list', () => {
    const snap = chooseModelSnapshot({ ...base, stored: undefined })
    expect(snap?.capabilities.maxReferenceImages).toBe(3)
  })

  it('leaves a model the settled list lacks to the lookup when nothing is stored for it', () => {
    expect(chooseModelSnapshot({ ...base, model: 'other' })).toBeUndefined()
  })

  it('keeps the stored snapshot when a settled list lacks the model', () => {
    const profile = stored({ model: 'alias', modelSnapshot: snapshotModel('alias', info()) })
    const snap = chooseModelSnapshot({ ...base, model: 'alias', stored: profile })
    expect(snap).toBe(profile.modelSnapshot)
  })

  it('keeps the stored snapshot while the list is unsettled', () => {
    const snap = chooseModelSnapshot({ ...base, settled: false, models: [] })
    expect(snap).toBe(base.stored.modelSnapshot)
  })

  it('keeps it when the list settled empty', () => {
    expect(chooseModelSnapshot({ ...base, models: [] })).toBe(base.stored.modelSnapshot)
  })

  it('drops it when the provider changes', () => {
    const snap = chooseModelSnapshot({
      ...base,
      settled: false,
      providerType: 'openai-compatible',
    })
    expect(snap).toBeUndefined()
  })

  it('drops it when the base URL changes', () => {
    const snap = chooseModelSnapshot({
      ...base,
      settled: false,
      baseUrl: 'https://other.example/v1',
    })
    expect(snap).toBeUndefined()
  })

  it('drops it when the model changes while the list is unsettled', () => {
    const snap = chooseModelSnapshot({ ...base, settled: false, models: [], model: 'other' })
    expect(snap).toBeUndefined()
  })

  it('keeps it across a trailing-slash edit', () => {
    const profile = stored({ baseUrl: 'https://x.example/v1' })
    const snap = chooseModelSnapshot({
      ...base,
      settled: false,
      stored: profile,
      baseUrl: 'https://x.example/v1/',
    })
    expect(snap).toBe(profile.modelSnapshot)
  })

  it('is undefined without a model', () => {
    expect(chooseModelSnapshot({ ...base, model: '' })).toBeUndefined()
  })
})
