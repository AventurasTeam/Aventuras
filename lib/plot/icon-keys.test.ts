import { describe, expect, it } from 'vitest'

import { isPlotIconKey } from './icon-keys'

describe('isPlotIconKey', () => {
  it.each(['sparkles', 'book', 'map'])('takes the catalog key %s', (key) => {
    expect(isPlotIconKey(key)).toBe(true)
  })

  // A stored key such as `constructor` must fall back, not resolve to Object's own property.
  it.each(['lantern', '', 'Sparkles', 'constructor', 'toString'])('refuses %j', (key) => {
    expect(isPlotIconKey(key)).toBe(false)
  })
})
