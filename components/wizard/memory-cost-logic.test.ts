import { describe, expect, it } from 'vitest'

import {
  PROJECTED_ROWS,
  clampEffectiveDim,
  dimLadder,
  disclosureVisible,
  storagePreviewBytes,
  suggestedDim,
  validateCustomDim,
} from './memory-cost-logic'

describe('memory-cost-logic', () => {
  it('visible only when backend is provider AND model declares matryoshkaSupported', () => {
    expect(disclosureVisible({ embeddingBackend: 'provider' }, { matryoshkaSupported: true })).toBe(
      true,
    )
    expect(disclosureVisible({ embeddingBackend: 'local' }, { matryoshkaSupported: true })).toBe(
      false,
    )
    expect(disclosureVisible({ embeddingBackend: 'provider' }, undefined)).toBe(false)
  })

  it('ladder mirrors matryoshkaDims, else falls back to [512, 1024, 2048]', () => {
    expect(dimLadder({ matryoshkaSupported: true, matryoshkaDims: [256, 512, 1024] })).toEqual([
      256, 512, 1024,
    ])
    expect(dimLadder({ matryoshkaSupported: true })).toEqual([512, 1024, 2048])
  })

  it('platform suggestion: mobile = smallest curated dim ≥ 512, desktop = native (null)', () => {
    expect(suggestedDim([256, 512, 1024], 'mobile')).toBe(512)
    expect(suggestedDim([256, 512, 1024], 'desktop')).toBeNull()
  })

  it('mobile falls back to the largest dim when none reaches the ≥ 512 floor', () => {
    expect(suggestedDim([128, 256], 'mobile')).toBe(256)
  })

  it('storage preview is dim × 4 bytes × projected rows', () => {
    expect(storagePreviewBytes(1024)).toBe(1024 * 4 * PROJECTED_ROWS)
  })

  it('custom dim validation: positive integer required', () => {
    expect(validateCustomDim('1024').ok).toBe(true)
    expect(validateCustomDim('0').ok).toBe(false)
    expect(validateCustomDim('12.5').ok).toBe(false)
    expect(validateCustomDim('').ok).toBe(false)
  })

  it('custom dim validation surfaces the specific failure reason', () => {
    expect(validateCustomDim('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateCustomDim('12.5')).toEqual({ ok: false, reason: 'not-integer' })
    expect(validateCustomDim('0')).toEqual({ ok: false, reason: 'not-positive' })
    expect(validateCustomDim('1024')).toEqual({ ok: true, dim: 1024 })
  })

  it('custom dim validation rejects above the native ceiling, but only once it is known', () => {
    expect(validateCustomDim('4096', 2048)).toEqual({ ok: false, reason: 'above-native' })
    expect(validateCustomDim('2048', 2048)).toEqual({ ok: true, dim: 2048 })
    // Unprobed model: no ceiling exists to compare against, so the pick stands.
    expect(validateCustomDim('4096')).toEqual({ ok: true, dim: 4096 })
  })

  it('clamps an above-native dim to native, and leaves anything else alone', () => {
    expect(clampEffectiveDim(4096, 2048)).toBeNull()
    expect(clampEffectiveDim(1024, 2048)).toBe(1024)
    expect(clampEffectiveDim(2048, 2048)).toBe(2048)
    expect(clampEffectiveDim(null, 2048)).toBeNull()
    // An unknown ceiling cannot clamp: the dim rides through untouched.
    expect(clampEffectiveDim(4096, undefined)).toBe(4096)
  })
})
