import { describe, expect, it } from 'vitest'

import { compositeText, parseSourceHash, sourceHash } from './source-hash'

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

  // Every vector above is under 16 bytes, so they only exercise the short-input
  // tail. Real composite text (name + description) always takes the four-lane
  // accumulator branch, which those vectors never reach. Expectations below were
  // produced by an independent implementation of the xxHash32 spec, checked
  // against the published vectors before use.
  it('matches known vectors on the >=16-byte accumulator branch', () => {
    expect(sourceHash('0123456789abcdef')).toBe('c2c45b69')
    expect(sourceHash('0123456789abcdefg')).toBe('cc79b217')
    expect(sourceHash('The quick brown fox jumps over the lazy dog')).toBe('e85ea4de')
    expect(sourceHash('Kara Stoneheart a veteran scout of the northern reach')).toBe('fede0d1d')
  })

  it('matches a known vector at the boundary just below the accumulator branch', () => {
    expect(sourceHash('Kara Stoneheart')).toBe('36d682e2')
  })
})

describe('parseSourceHash', () => {
  it('accepts a value this module produced', () => {
    expect(parseSourceHash(sourceHash('Kara Stoneheart'))).toBe('36d682e2')
  })

  it.each([
    ['-77e5d848', 'the signed rendering the >>> 0 fix removed'],
    ['881A27B8', 'uppercase'],
    ['881a27b', 'too short'],
    ['881a27b80', 'too long'],
    ['', 'empty'],
  ])('rejects %s (%s)', (value) => {
    expect(parseSourceHash(value)).toBeNull()
  })

  it.each([[undefined], [null], [42], [Buffer.from('881a27b8')]])(
    'rejects the non-string %s a driver could hand back',
    (value) => {
      expect(parseSourceHash(value)).toBeNull()
    },
  )
})

describe('compositeText', () => {
  it('joins fields with a single-space separator, null-safe', () => {
    expect(compositeText(['Kara', null])).toBe('Kara ')
    expect(compositeText(['Kara', 'a scout'])).toBe('Kara a scout')
  })
})
