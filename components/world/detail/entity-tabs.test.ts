import { describe, expect, it } from 'vitest'

import { entityTabOf, entityTabs } from './entity-tabs'

describe('entityTabs', () => {
  it('gives characters all eight tabs and hides Carrying on other kinds', () => {
    expect(entityTabs('character')).toHaveLength(8)
    expect(entityTabs('location')).toHaveLength(7)
    expect(entityTabs('faction')).not.toContain('carrying')
  })

  it("orders each kind's tabs canonically", () => {
    expect(entityTabs('character')).toEqual([
      'overview',
      'identity',
      'carrying',
      'connections',
      'settings',
      'assets',
      'involvements',
      'history',
    ])
    const withoutCarrying = [
      'overview',
      'identity',
      'connections',
      'settings',
      'assets',
      'involvements',
      'history',
    ]
    expect(entityTabs('location')).toEqual(withoutCarrying)
    expect(entityTabs('item')).toEqual(withoutCarrying)
    expect(entityTabs('faction')).toEqual(withoutCarrying)
  })

  it('drops a deep-link tab the kind does not have', () => {
    expect(entityTabOf('character', 'carrying')).toBe('carrying')
    expect(entityTabOf('item', 'carrying')).toBeUndefined()
    expect(entityTabOf('item', 'bogus')).toBeUndefined()
  })
})
