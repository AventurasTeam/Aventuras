import { describe, expect, it } from 'vitest'

import { clamp, computeTextareaEnvelope } from './textarea-envelope'

describe('Textarea — height envelope', () => {
  it('clamps to a minimum derived from rows × line-height + padding', () => {
    const { minHeight } = computeTextareaEnvelope(3, 10, 12)
    // 3 × 20 + 12 × 2 = 84
    expect(minHeight).toBe(84)
  })

  it('clamps to a maximum derived from maxRows × line-height + padding', () => {
    const { maxHeight } = computeTextareaEnvelope(3, 10, 12)
    // 10 × 20 + 12 × 2 = 224
    expect(maxHeight).toBe(224)
  })

  it('respects compact-density padding (smaller envelope)', () => {
    const compactPad = 6
    const { minHeight, maxHeight } = computeTextareaEnvelope(3, 10, compactPad)
    // 3 × 20 + 6 × 2 = 72; 10 × 20 + 6 × 2 = 212
    expect(minHeight).toBe(72)
    expect(maxHeight).toBe(212)
  })

  it('respects comfortable-density padding (larger envelope)', () => {
    const comfortablePad = 16
    const { minHeight, maxHeight } = computeTextareaEnvelope(3, 10, comfortablePad)
    // 3 × 20 + 16 × 2 = 92; 10 × 20 + 16 × 2 = 232
    expect(minHeight).toBe(92)
    expect(maxHeight).toBe(232)
  })

  it('produces min < max when rows < maxRows', () => {
    const { minHeight, maxHeight } = computeTextareaEnvelope(2, 8, 12)
    expect(minHeight).toBeLessThan(maxHeight)
  })

  it('collapses to a fixed height when rows === maxRows', () => {
    const { minHeight, maxHeight } = computeTextareaEnvelope(5, 5, 12)
    expect(minHeight).toBe(maxHeight)
  })
})

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(50, 10, 100)).toBe(50)
  })
  it('returns min when below range', () => {
    expect(clamp(5, 10, 100)).toBe(10)
  })
  it('returns max when above range', () => {
    expect(clamp(150, 10, 100)).toBe(100)
  })
  it('handles min === max', () => {
    expect(clamp(100, 50, 50)).toBe(50)
  })
})
