import { describe, expect, it, vi } from 'vitest'

import { changesOnly } from './select-pick'

describe('changesOnly', () => {
  // Native radio items fire on every press, and native dropdown items hand the primitive a
  // fresh { value, label } its controlled-state check compares by reference, a re-pick included.
  it('drops a re-pick of the current value', () => {
    const onValueChange = vi.fn()
    changesOnly('character', onValueChange)('character')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('reports a pick of another value', () => {
    const onValueChange = vi.fn()
    changesOnly('character', onValueChange)('location')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('location')
  })

  it('reports a first pick', () => {
    const onValueChange = vi.fn()
    changesOnly(undefined, onValueChange)('location')
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('location')
  })
})
