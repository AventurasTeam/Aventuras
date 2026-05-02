import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'

describe('relativeLuminance', () => {
  it('white = 1.0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2)
  })
  it('black = 0.0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2)
  })
})

describe('contrastRatio', () => {
  it('black on white = 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })
  it('white on white = 1', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2)
  })
  it('symmetric', () => {
    expect(contrastRatio('#0a0a0a', '#fafafa')).toBeCloseTo(contrastRatio('#fafafa', '#0a0a0a'), 2)
  })
  it('rejects malformed hex', () => {
    expect(() => contrastRatio('not-hex', '#fff')).toThrow()
  })
})
