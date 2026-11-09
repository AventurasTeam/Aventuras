import { describe, expect, it } from 'vitest'
import {
  applyCapabilityOverride,
  canonicalModelId,
  overriddenFields,
  overrideConflicts,
  pickCapabilities,
} from './modelCapabilities'
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

describe('pickCapabilities', () => {
  it('keeps capabilities and drops catalogue fields', () => {
    const picked = pickCapabilities(info())
    expect(picked).toMatchObject({
      supportsImg2Img: true,
      maxReferenceImages: 3,
      supportedResolutions: ['1k', '2k'],
      supportedAspectRatios: ['1:1', '16:9'],
    })
    expect(picked).not.toHaveProperty('name')
  })

  it('shares no arrays with the source', () => {
    const source = info({
      referenceConstraints: { maxBytes: 10, mimeTypes: ['image/png'] },
    })
    const picked = pickCapabilities(source)
    source.supportedResolutions?.push('4k')
    source.referenceConstraints?.mimeTypes?.push('image/webp')
    expect(picked.supportedResolutions).toEqual(['1k', '2k'])
    expect(picked.referenceConstraints?.mimeTypes).toEqual(['image/png'])
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
