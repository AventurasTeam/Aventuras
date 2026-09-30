import { describe, expect, it } from 'vitest'
import type { Character } from '$lib/types'
import { refreshCharacter } from './portraitReferences'

function character(overrides: Partial<Character> & Pick<Character, 'id'>): Character {
  return { name: 'Mira', portrait: null, ...overrides } as Character
}

describe('refreshCharacter', () => {
  it('returns the live entry with the same id', () => {
    const stale = character({ id: 'a' })
    const live = character({ id: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [live])).toBe(live)
  })

  it('follows a copy-on-write swap to the override', () => {
    const stale = character({ id: 'a' })
    const override = character({ id: 'b', overridesId: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [override])).toBe(override)
  })

  it('matches an override against its original', () => {
    const stale = character({ id: 'b', overridesId: 'a' })
    const live = character({ id: 'a', portrait: 'img' })
    expect(refreshCharacter(stale, [live])).toBe(live)
  })

  it('does not match a different character with the same name', () => {
    const stale = character({ id: 'a' })
    const other = character({ id: 'z', portrait: 'img' })
    expect(refreshCharacter(stale, [other])).toBe(stale)
  })

  it('keeps the given character when it is no longer live', () => {
    const stale = character({ id: 'a' })
    expect(refreshCharacter(stale, [])).toBe(stale)
  })
})
