import { describe, expect, it } from 'vitest'

import { entityTabOf, entityTabs } from './entity-tabs'

describe('entityTabs', () => {
  it('gives characters all eight tabs and hides Carrying on other kinds', () => {
    expect(entityTabs('character')).toHaveLength(8)
    expect(entityTabs('location')).toHaveLength(7)
    expect(entityTabs('faction')).not.toContain('carrying')
  })

  it('drops a deep-link tab the kind does not have', () => {
    expect(entityTabOf('character', 'carrying')).toBe('carrying')
    expect(entityTabOf('item', 'carrying')).toBeUndefined()
    expect(entityTabOf('item', 'bogus')).toBeUndefined()
  })
})
