import { describe, expect, it } from 'vitest'

import { compositeText, sourceHash } from './source-hash'

describe('sourceHash (xxh32, seed 0)', () => {
  // Published xxh32 vectors
  it('matches known vectors', () => {
    expect(sourceHash('')).toBe('02cc5d05')
    expect(sourceHash('a')).toBe('550d7456')
    expect(sourceHash('abc')).toBe('32d153ff')
  })
  it('is stable across calls', () => {
    expect(sourceHash('Kara desc')).toBe(sourceHash('Kara desc'))
  })
})

describe('compositeText', () => {
  it('joins fields with a single-space separator, null-safe', () => {
    expect(compositeText(['Kara', null])).toBe('Kara ')
    expect(compositeText(['Kara', 'a scout'])).toBe('Kara a scout')
  })
})
