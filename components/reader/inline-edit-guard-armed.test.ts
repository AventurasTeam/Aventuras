import { describe, expect, it } from 'vitest'

import { inlineEditGuardArmed } from './inline-edit-guard-armed'

describe('inlineEditGuardArmed', () => {
  it('arms on web for a dirty editor only', () => {
    expect(inlineEditGuardArmed({ platform: 'web', session: { dirty: true }, held: false })).toBe(
      true,
    )
    expect(inlineEditGuardArmed({ platform: 'web', session: { dirty: false }, held: false })).toBe(
      false,
    )
    expect(inlineEditGuardArmed({ platform: 'web', session: null, held: false })).toBe(false)
  })

  // A dirty report can still be crossing the bridge.
  it('arms on native for any open editor', () => {
    expect(
      inlineEditGuardArmed({ platform: 'native', session: { dirty: false }, held: false }),
    ).toBe(true)
    expect(
      inlineEditGuardArmed({ platform: 'native', session: { dirty: true }, held: false }),
    ).toBe(true)
    expect(inlineEditGuardArmed({ platform: 'native', session: null, held: false })).toBe(false)
  })

  // The press ran the guard before it took the hold; an armed guard would swallow the reset.
  it.each(['web', 'native'] as const)('never arms on %s while the reader is held', (platform) => {
    expect(inlineEditGuardArmed({ platform, session: { dirty: true }, held: true })).toBe(false)
    expect(inlineEditGuardArmed({ platform, session: { dirty: false }, held: true })).toBe(false)
    expect(inlineEditGuardArmed({ platform, session: null, held: true })).toBe(false)
  })
})
