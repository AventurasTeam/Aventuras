import { describe, expect, it } from 'vitest'

import { changedPick } from './select-pick'

describe('changedPick', () => {
  // Native items report every press as a fresh { value, label }, a re-pick included, and
  // the primitive's controlled-state check compares by reference, so it lets them through.
  it('drops a re-pick of the current value', () => {
    expect(changedPick('character', { value: 'character' })).toBeNull()
  })

  it('reports a pick of another value', () => {
    expect(changedPick('character', { value: 'location' })).toBe('location')
  })

  it('reports a first pick', () => {
    expect(changedPick(undefined, { value: 'location' })).toBe('location')
  })

  it('drops an empty pick', () => {
    expect(changedPick('character', undefined)).toBeNull()
  })
})
