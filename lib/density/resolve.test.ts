import { describe, expect, it } from 'vitest'
import { resolveDensity } from './resolve'

describe('resolveDensity', () => {
  it('default → compact on desktop', () => {
    expect(resolveDensity('default', 'desktop')).toBe('compact')
  })

  it('default → regular on phone and tablet', () => {
    expect(resolveDensity('default', 'phone')).toBe('regular')
    expect(resolveDensity('default', 'tablet')).toBe('regular')
  })

  it('explicit values pin regardless of tier', () => {
    expect(resolveDensity('compact', 'phone')).toBe('compact')
    expect(resolveDensity('comfortable', 'desktop')).toBe('comfortable')
    expect(resolveDensity('regular', 'tablet')).toBe('regular')
  })
})
