import { describe, expect, it } from 'vitest'

import { settingsCount } from './settings-number'

describe('settingsCount', () => {
  it('passes a well-formed value through', () => {
    expect(settingsCount(7, 1)).toBe(7)
  })

  // The schema omits .int() on purpose, so a fractional value is a shape the
  // read sites genuinely see rather than a defensive hypothetical.
  it('floors a fractional value rather than rounding it', () => {
    expect(settingsCount(7.9, 1)).toBe(7)
  })

  it('raises a value below the floor to the floor', () => {
    expect(settingsCount(-4, 1)).toBe(1)
  })

  it('honours a zero floor rather than assuming one', () => {
    expect(settingsCount(-4, 0)).toBe(0)
  })

  // Flooring first is what makes this distinct from a plain clamp: 0.5 against
  // a floor of 1 must land on 1, not on 0.5.
  it('floors before clamping', () => {
    expect(settingsCount(0.5, 1)).toBe(1)
  })

  it.each([NaN, Infinity, -Infinity])('falls back to the floor for %p', (value) => {
    expect(settingsCount(value, 3)).toBe(3)
  })
})
