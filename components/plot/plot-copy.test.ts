import { describe, expect, it, vi } from 'vitest'

import { iconFromOption, iconOptionValue, plotIconOptions } from './plot-copy'

// The real catalog pulls lucide-react-native, which node can't parse.
vi.mock('./plot-icon', () => ({ PLOT_ICON_KEYS: ['sparkles', 'eye'] }))

describe('plot icon options', () => {
  it('never offers an empty value, which Radix Select refuses', () => {
    for (const current of [null, '', 'sparkles', 'lantern']) {
      expect(plotIconOptions(current).map((o) => o.value)).not.toContain('')
    }
  })

  it("keeps a stored key the catalog doesn't know, first after none", () => {
    expect(
      plotIconOptions('lantern')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['lantern', 'sparkles', 'eye'])
    expect(
      plotIconOptions('sparkles')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['sparkles', 'eye'])
    expect(
      plotIconOptions('')
        .map((o) => o.value)
        .slice(1),
    ).toEqual(['sparkles', 'eye'])
  })

  it('round-trips none as null and a key as itself', () => {
    const none = plotIconOptions(null)[0]
    expect(none.label).toBe('No icon')
    expect(iconOptionValue(null)).toBe(none.value)
    expect(iconOptionValue('')).toBe(none.value)
    expect(iconFromOption(none.value)).toBeNull()
    expect(iconFromOption(iconOptionValue('eye'))).toBe('eye')
  })
})
