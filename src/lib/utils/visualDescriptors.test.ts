import { describe, it, expect } from 'vitest'
import {
  descriptorsToString,
  stringToDescriptors,
  hasDescriptors,
  formatDescriptorsForPrompt,
} from './visualDescriptors'

describe('stringToDescriptors', () => {
  it('parses category-labeled input', () => {
    const result = stringToDescriptors('Face: angular jawline, Hair: brown')
    expect(result.face).toBe('angular jawline')
    expect(result.hair).toBe('brown')
  })

  it('handles all seven categories', () => {
    const input =
      'Face: sharp, Hair: dark, Eyes: blue, Build: lean, Clothing: leather, Accessories: ring, Distinguishing: scar'
    const result = stringToDescriptors(input)
    expect(Object.keys(result)).toHaveLength(7)
  })

  it('returns empty object for empty string', () => {
    expect(stringToDescriptors('')).toEqual({})
  })

  it('returns empty object for whitespace-only input', () => {
    expect(stringToDescriptors('   ')).toEqual({})
  })

  it('returns empty object for text without category labels', () => {
    expect(stringToDescriptors('tall, dark hair, blue eyes')).toEqual({})
  })

  it('is case-insensitive for category labels', () => {
    const result = stringToDescriptors('FACE: angular, hair: brown')
    expect(result.face).toBe('angular')
    expect(result.hair).toBe('brown')
  })

  it('trims trailing commas from values', () => {
    const result = stringToDescriptors('Face: angular,')
    expect(result.face).toBe('angular')
  })
})

describe('hasDescriptors', () => {
  it('returns false for null', () => {
    expect(hasDescriptors(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(hasDescriptors(undefined)).toBe(false)
  })

  it('returns false for empty object', () => {
    expect(hasDescriptors({})).toBe(false)
  })

  it('returns false when all values are empty strings', () => {
    expect(hasDescriptors({ face: '', hair: '' })).toBe(false)
  })

  it('returns true when at least one field has content', () => {
    expect(hasDescriptors({ face: 'angular' })).toBe(true)
  })
})

describe('descriptorsToString', () => {
  it('formats populated fields in category order', () => {
    const result = descriptorsToString({ face: 'angular', hair: 'brown' })
    expect(result).toBe('Face: angular, Hair: brown')
  })

  it('returns empty string for null', () => {
    expect(descriptorsToString(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(descriptorsToString(undefined)).toBe('')
  })

  it('skips empty fields', () => {
    const result = descriptorsToString({ face: 'angular', hair: '', eyes: 'blue' })
    expect(result).toBe('Face: angular, Eyes: blue')
  })
})

describe('formatDescriptorsForPrompt', () => {
  it('produces same output as descriptorsToString', () => {
    const descriptors = { face: 'angular', hair: 'brown' }
    expect(formatDescriptorsForPrompt(descriptors)).toBe(descriptorsToString(descriptors))
  })

  it('returns empty string for null', () => {
    expect(formatDescriptorsForPrompt(null)).toBe('')
  })
})
