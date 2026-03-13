import { describe, it, expect } from 'vitest'
import { normalizeAppearance } from './context-utils'

describe('normalizeAppearance', () => {
  it('returns empty array for null input', () => {
    expect(normalizeAppearance(null)).toHaveLength(0)
  })

  it('returns empty array for undefined input', () => {
    expect(normalizeAppearance(undefined)).toHaveLength(0)
  })

  it('returns empty array for empty object {}', () => {
    const result = normalizeAppearance({})
    expect(result).toHaveLength(0)
  })

  it('handles legacy string[] format: filters and maps values', () => {
    const result = normalizeAppearance(['sharp features', 'dark hair'])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('sharp features')
    expect(result[1]).toBe('dark hair')
  })

  it('handles object format: extracts string values for each field', () => {
    const result = normalizeAppearance({ face: 'sharp', hair: 'dark' })
    expect(result).toHaveLength(2)
    expect(result).toContain('sharp')
    expect(result).toContain('dark')
  })

  it('handles full object with all 7 fields and returns array of length 7', () => {
    const full = {
      face: 'Sharp cheekbones',
      hair: 'Dark brown braid',
      eyes: 'Amber',
      build: 'Lean and athletic',
      clothing: 'Leather travelling gear',
      accessories: 'Quiver of arrows',
      distinguishing: 'Scar above right eyebrow',
    }
    const result = normalizeAppearance(full)
    expect(result).toHaveLength(7)
  })

  it('filters out falsy values from array format', () => {
    const result = normalizeAppearance([null, '', 'valid'])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('valid')
  })

  it('handles object with some empty fields: returns only truthy values', () => {
    const result = normalizeAppearance({ face: 'sharp', hair: '', eyes: null })
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('sharp')
  })
})
