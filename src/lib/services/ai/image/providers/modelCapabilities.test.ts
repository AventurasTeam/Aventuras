import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageProfile } from '#lib/types/index.ts'
import {
  IMAGE_MODEL_SNAPSHOT_VERSION,
  applyCapabilityOverride,
  canonicalModelId,
  chooseModelSnapshot,
  overriddenFields,
  overrideConflicts,
  sameSnapshot,
  snapshotModel,
} from './modelCapabilities'
import { imageConnectionFor } from './connection'
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
  ...imageConnectionFor('nanogpt', 'k', undefined),
  id: 'p1',
  name: 'p',
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

describe('chooseModelSnapshot', () => {
  const base = {
    model: 'm1',
    connection: imageConnectionFor('nanogpt', 'k', undefined),
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
      connection: imageConnectionFor('openai-compatible', 'k', undefined),
    })
    expect(snap).toBeUndefined()
  })

  it('drops it when the base URL changes', () => {
    const snap = chooseModelSnapshot({
      ...base,
      settled: false,
      connection: imageConnectionFor('nanogpt', 'k', 'https://other.example/v1'),
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
      connection: imageConnectionFor('nanogpt', 'k', 'https://x.example/v1/'),
    })
    expect(snap).toBe(profile.modelSnapshot)
  })

  it('is undefined without a model', () => {
    expect(chooseModelSnapshot({ ...base, model: '' })).toBeUndefined()
  })

  it('returns the stored snapshot when the list says the same thing, as loaded from JSON', () => {
    const reloaded: ImageProfile = JSON.parse(JSON.stringify(base.stored))
    const snap = chooseModelSnapshot({ ...base, stored: reloaded })
    expect(snap).toBe(reloaded.modelSnapshot)
  })

  it('captures anew when the listed capabilities changed', () => {
    const reloaded: ImageProfile = JSON.parse(JSON.stringify(base.stored))
    const snap = chooseModelSnapshot({
      ...base,
      stored: reloaded,
      models: [info({ maxReferenceImages: 5 })],
    })
    expect(snap).not.toBe(reloaded.modelSnapshot)
    expect(snap?.capabilities.maxReferenceImages).toBe(5)
  })
})

describe('sameSnapshot', () => {
  it('ignores when it was captured and keys left undefined', () => {
    const a = snapshotModel('m1', info())
    const b = { ...JSON.parse(JSON.stringify(a)), capturedAt: a.capturedAt + 1 }
    expect(sameSnapshot(a, b)).toBe(true)
  })

  it('differs by model, version or capabilities', () => {
    const a = snapshotModel('m1', info())
    expect(sameSnapshot(a, snapshotModel('m2', info()))).toBe(false)
    expect(sameSnapshot(a, { ...a, version: a.version + 1 })).toBe(false)
    expect(sameSnapshot(a, snapshotModel('m1', info({ supportedResolutions: ['1k'] })))).toBe(false)
  })
})

describe('applyCapabilityOverride', () => {
  const listed = {
    supportsImg2Img: true,
    maxReferenceImages: 3,
    supportedResolutions: ['1k'],
  }

  it('changes nothing without an override or with a blank one', () => {
    expect(applyCapabilityOverride(listed, undefined)).toBe(listed)
    expect(applyCapabilityOverride(listed, {})).toEqual(listed)
  })

  it('replaces the sizes and sets the pixel floor', () => {
    expect(applyCapabilityOverride(listed, { sizes: ['1024x1024'], minPixels: 655_360 })).toEqual({
      ...listed,
      supportedResolutions: ['1024x1024'],
      minPixels: 655_360,
    })
  })

  it('turns references off, whatever the list says', () => {
    expect(applyCapabilityOverride(listed, { references: false })).toMatchObject({
      supportsImg2Img: false,
      maxReferenceImages: 0,
    })
  })

  it('turns references on, lifting a listed limit of none', () => {
    const result = applyCapabilityOverride(
      { supportsImg2Img: false, maxReferenceImages: 0 },
      { references: true },
    )
    expect(result).toEqual({ supportsImg2Img: true })
  })

  it('applies over a model the provider knows nothing about', () => {
    expect(applyCapabilityOverride(undefined, { minPixels: 100 })).toEqual({ minPixels: 100 })
  })
})

describe('overrideConflicts', () => {
  it('warns when References is Off for a model the provider says needs a reference', () => {
    const conflicts = overrideConflicts({ references: false }, { requiresReferenceImage: true })
    expect(conflicts.map((c) => c.field)).toEqual(['references'])
  })

  it('is quiet when nothing contradicts the published capabilities', () => {
    expect(overrideConflicts({ references: false }, { supportsImg2Img: true })).toEqual([])
    expect(overrideConflicts({ references: true }, { requiresReferenceImage: true })).toEqual([])
    expect(overrideConflicts({ sizes: ['1024x1024'] }, { requiresReferenceImage: true })).toEqual(
      [],
    )
    expect(overrideConflicts(undefined, { requiresReferenceImage: true })).toEqual([])
    expect(overrideConflicts({ references: false }, undefined)).toEqual([])
  })
})

describe('overriddenFields', () => {
  it('names the fields that replace something the provider published', () => {
    expect(
      overriddenFields(
        { sizes: ['1024x1024'], references: false, minPixels: 100 },
        { supportedResolutions: ['1k'], supportsImg2Img: true },
      ),
    ).toEqual(['sizes', 'references'])
  })

  it('names nothing where the provider published nothing', () => {
    expect(overriddenFields({ sizes: ['1024x1024'], references: false }, {})).toEqual([])
    expect(overriddenFields({ sizes: ['1024x1024'] }, undefined)).toEqual([])
  })
})

describe('canonicalModelId', () => {
  const models = [info({ id: 'flux', aliases: ['flux-dev', 'f'] }), info({ id: 'turbo' })]

  it('keeps an id the list has, and any id it does not know', () => {
    expect(canonicalModelId('flux', models)).toBe('flux')
    expect(canonicalModelId('mystery', models)).toBe('mystery')
  })

  it('swaps an alias for its model id', () => {
    expect(canonicalModelId('flux-dev', models)).toBe('flux')
  })

  it('prefers a model whose id is the typed text over another model listing it as an alias', () => {
    const list = [info({ id: 'a', aliases: ['b'] }), info({ id: 'b' })]
    expect(canonicalModelId('b', list)).toBe('b')
  })
})
