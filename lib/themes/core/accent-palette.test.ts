import { describe, expect, it } from 'vitest'

import {
  CURATED_ACCENT_PALETTE,
  CURATED_ACCENT_SLOTS,
  NEUTRAL_ACCENT,
  resolveAccentColor,
  slotForHex,
} from './accent-palette'

describe('CURATED_ACCENT_PALETTE', () => {
  it('carries the seven slots from docs/ui/foundations/color.md', () => {
    expect(CURATED_ACCENT_SLOTS).toEqual([
      'red',
      'orange',
      'green',
      'teal',
      'blue',
      'indigo',
      'pink',
    ])
    expect(CURATED_ACCENT_PALETTE.blue).toBe('#2563eb')
  })
})

describe('resolveAccentColor', () => {
  it('resolves a curated slot key to its hex', () => {
    expect(resolveAccentColor('blue')).toBe('#2563eb')
  })

  it('passes a custom hex through', () => {
    expect(resolveAccentColor('#7c3aed')).toBe('#7c3aed')
  })

  it('falls back to neutral for an unknown value', () => {
    expect(resolveAccentColor('chartreuse')).toBe(NEUTRAL_ACCENT)
  })

  it('falls back to neutral for null and undefined', () => {
    expect(resolveAccentColor(null)).toBe(NEUTRAL_ACCENT)
    expect(resolveAccentColor(undefined)).toBe(NEUTRAL_ACCENT)
  })
})

describe('slotForHex', () => {
  it('reverse-looks-up a curated hex to its slot, case-insensitively', () => {
    expect(slotForHex('#2563EB')).toBe('blue')
  })

  it('returns undefined for a custom hex', () => {
    expect(slotForHex('#7c3aed')).toBeUndefined()
  })
})
