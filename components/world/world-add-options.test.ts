import { describe, expect, it, vi } from 'vitest'

import { worldAddOptions } from './world-add-options'

describe('worldAddOptions', () => {
  it('enables Blank for an entity category and runs it; the file and Vault options stay disabled', () => {
    const onBlank = vi.fn()
    const options = worldAddOptions('character', onBlank, {})
    expect(options.map((o) => [o.key, o.label, o.disabled ?? false, o.disabledReason])).toEqual([
      ['blank', 'Blank', false, undefined],
      ['json', 'From JSON file…', true, 'Lands in Slice 4.6'],
      ['vault', 'From Vault…', true, 'Vault lands in M8'],
    ])
    options[0].onPress?.()
    expect(onBlank).toHaveBeenCalledTimes(1)
  })

  it('gates Blank while generation is in flight', () => {
    const [blank] = worldAddOptions('item', () => {}, { disabled: true, disabledReason: 'busy' })
    expect([blank.disabled, blank.disabledReason]).toEqual([true, 'busy'])
  })

  it('keeps Blank disabled on Lore until 4.2b', () => {
    const [blank] = worldAddOptions('lore', () => {}, {})
    expect([blank.disabled, blank.disabledReason]).toEqual([true, 'Lands in Slice 4.2b'])
  })
})
