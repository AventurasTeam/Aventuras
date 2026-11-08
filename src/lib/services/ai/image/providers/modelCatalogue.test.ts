import { describe, it, expect } from 'vitest'
import { editsOnly, nonEmpty, referenceSupport } from './modelCatalogue'

describe('catalogue helpers', () => {
  it('drops an empty list', () => {
    expect(nonEmpty([])).toBeUndefined()
    expect(nonEmpty(undefined)).toBeUndefined()
    expect(nonEmpty(['a'])).toEqual(['a'])
  })

  it('reads whether a model takes references, leaving unreadable inputs unknown', () => {
    expect(referenceSupport(['text'], 2)).toBe(true)
    expect(referenceSupport(['text', 'image'], undefined)).toBe(true)
    expect(referenceSupport(['text'], undefined)).toBe(false)
    expect(referenceSupport(undefined, undefined)).toBeUndefined()
  })

  it('marks only a model that takes images and no text as edit-only', () => {
    expect(editsOnly(['image'])).toBe(true)
    expect(editsOnly(['text', 'image'])).toBe(false)
    expect(editsOnly(undefined)).toBe(false)
  })
})
