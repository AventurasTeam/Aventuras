import { describe, expect, it } from 'vitest'

import { worldAddOptions } from './world-add-options'

describe('worldAddOptions', () => {
  it('ships Blank / From JSON file… / From Vault… present-but-disabled with their reasons', () => {
    const options = worldAddOptions('character')
    expect(options.map((o) => [o.key, o.label, o.disabled, o.disabledReason])).toEqual([
      ['blank', 'Blank', true, 'Lands in Slice 4.2a'],
      ['json', 'From JSON file…', true, 'Lands in Slice 4.6'],
      ['vault', 'From Vault…', true, 'Vault lands in M8'],
    ])
  })

  it('names the lore slice for Blank on the Lore category', () => {
    expect(worldAddOptions('lore')[0].disabledReason).toBe('Lands in Slice 4.2b')
  })
})
