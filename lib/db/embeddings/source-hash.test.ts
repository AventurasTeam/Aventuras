import { describe, expect, it } from 'vitest'

import { compositeText, sourceHash } from './source-hash'

describe('sourceHash (xxh32, seed 0)', () => {
  // Published xxh32 vectors
  it('matches known vectors', () => {
    expect(sourceHash('')).toBe('02cc5d05')
    expect(sourceHash('a')).toBe('550d7456')
    expect(sourceHash('abc')).toBe('32d153ff')
    // High-bit-set vector: the three above all hash below 0x80000000, so they
    // pass even when the signed int32 leaks into the output ('-77e5d848').
    expect(sourceHash('Char ')).toBe('881a27b8')
  })
  it('always emits 8 lowercase hex chars, never a signed value', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(sourceHash(`row-${i}`)).toMatch(/^[0-9a-f]{8}$/)
    }
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
