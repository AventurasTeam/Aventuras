import { describe, expect, it, vi } from 'vitest'

import { worldAddOptions } from './world-add-options'

describe('worldAddOptions', () => {
  it('enables Blank and runs it; the file and Vault options stay disabled', () => {
    const onBlank = vi.fn()
    const options = worldAddOptions(onBlank, {})
    expect(options.map((o) => [o.key, o.label, o.disabled ?? false, o.disabledReason])).toEqual([
      ['blank', 'Blank', false, undefined],
      ['json', 'From JSON file…', true, 'Lands in Slice 4.6'],
      ['vault', 'From Vault…', true, 'Vault lands in M8'],
    ])
    options[0].onPress?.()
    expect(onBlank).toHaveBeenCalledTimes(1)
  })

  it('gates Blank while generation is in flight', () => {
    const [blank] = worldAddOptions(() => {}, { disabled: true, disabledReason: 'busy' })
    expect([blank.disabled, blank.disabledReason]).toEqual([true, 'busy'])
  })

  it('is enabled and fires onBlank', () => {
    const onBlank = vi.fn()
    const [blank] = worldAddOptions(onBlank, {})
    expect(blank).toMatchObject({ key: 'blank', disabled: undefined })
    blank.onPress?.()
    expect(onBlank).toHaveBeenCalledTimes(1)
  })
})
