import { describe, expect, it, vi } from 'vitest'

import { worldAddOptions } from './world-add-options'

const IN_FLIGHT = 'Generation is in flight. Cancel to edit.'

const handlers = () => ({ onBlank: vi.fn(), onJson: vi.fn() })

describe('worldAddOptions', () => {
  it('offers Blank and From JSON live; From Vault stays disabled', () => {
    const options = worldAddOptions(handlers(), {})
    expect(options.map((o) => [o.key, o.label, o.disabled ?? false, o.disabledReason])).toEqual([
      ['blank', 'Blank', false, undefined],
      ['json', 'From JSON file…', false, undefined],
      ['vault', 'From Vault…', true, 'Vault lands in M8'],
    ])
  })

  it('runs each live option through its own handler', () => {
    const h = handlers()
    const options = worldAddOptions(h, {})
    options.find((o) => o.key === 'json')?.onPress?.()
    expect(h.onJson).toHaveBeenCalledTimes(1)
    expect(h.onBlank).not.toHaveBeenCalled()
    options.find((o) => o.key === 'blank')?.onPress?.()
    expect(h.onBlank).toHaveBeenCalledTimes(1)
    expect(h.onJson).toHaveBeenCalledTimes(1)
  })

  it('disables Blank and From JSON with the in-flight reason during a turn', () => {
    const options = worldAddOptions(handlers(), { disabled: true, disabledReason: IN_FLIGHT })
    expect(options.map((o) => [o.key, o.disabled ?? false, o.disabledReason])).toEqual([
      ['blank', true, IN_FLIGHT],
      ['json', true, IN_FLIGHT],
      ['vault', true, 'Vault lands in M8'],
    ])
  })
})
