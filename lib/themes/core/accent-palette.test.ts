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

  it('pins the neutral fallback to a real value', () => {
    // Every other fallback case compares against the imported constant, so
    // without this the suite still passes if NEUTRAL_ACCENT becomes garbage.
    expect(NEUTRAL_ACCENT).toBe('#71717a')
  })
})

describe('resolveAccentColor', () => {
  it('resolves a curated slot key to its hex', () => {
    expect(resolveAccentColor('blue')).toBe('#2563eb')
  })

  it('passes a custom hex through', () => {
    expect(resolveAccentColor('#7c3aed')).toBe('#7c3aed')
  })

  it('passes 3-digit shorthand hex through', () => {
    expect(resolveAccentColor('#abc')).toBe('#abc')
  })

  it('falls back to neutral for an unknown value', () => {
    expect(resolveAccentColor('chartreuse')).toBe(NEUTRAL_ACCENT)
  })

  it('falls back to neutral for null and undefined', () => {
    expect(resolveAccentColor(null)).toBe(NEUTRAL_ACCENT)
    expect(resolveAccentColor(undefined)).toBe(NEUTRAL_ACCENT)
  })

  it('falls back to neutral for Object.prototype keys', () => {
    // `color` is a bare z.string() column, so a corrupted row or a hostile
    // import can hold any string — a prototype-chain membership check would
    // return a function from a String-returning fallback.
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(resolveAccentColor(key)).toBe(NEUTRAL_ACCENT)
    }
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
