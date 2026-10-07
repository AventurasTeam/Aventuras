import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RAIL_VIEW,
  isRailCategory,
  RAIL_CATEGORIES,
  RAIL_GROUPS,
  railGroupOf,
  railViewFor,
} from './categories'

const SEVEN = ['character', 'location', 'item', 'faction', 'lore', 'thread', 'happening']

describe('rail categories', () => {
  it('lists the seven row categories in order', () => {
    expect(RAIL_CATEGORIES).toEqual(SEVEN)
  })

  it('groups them World then Plot, in the dropdown order, each exactly once', () => {
    expect(RAIL_GROUPS).toEqual({
      world: ['character', 'location', 'item', 'faction', 'lore'],
      plot: ['thread', 'happening'],
    })
    expect([...RAIL_GROUPS.world, ...RAIL_GROUPS.plot]).toEqual([...RAIL_CATEGORIES])
  })

  it.each([
    ['character', 'world'],
    ['location', 'world'],
    ['item', 'world'],
    ['faction', 'world'],
    ['lore', 'world'],
    ['thread', 'plot'],
    ['happening', 'plot'],
  ] as const)('puts %s under %s', (category, group) => {
    expect(railGroupOf(category)).toBe(group)
  })

  it('recognises the seven and nothing else', () => {
    for (const category of SEVEN) expect(isRailCategory(category)).toBe(true)
    for (const value of ['entity', 'Characters', 'places', '', 'toString', null, undefined, 3]) {
      expect(isRailCategory(value)).toBe(false)
    }
  })
})

describe('railViewFor', () => {
  it.each(['character', 'location', 'item', 'faction'] as const)(
    'gives the %s view the entity filter at all and an empty search',
    (category) => {
      expect(railViewFor(category)).toStrictEqual({ category, filter: 'all', search: '' })
    },
  )

  it('gives lore a search and no filter', () => {
    expect(railViewFor('lore')).toStrictEqual({ category: 'lore', search: '' })
  })

  it.each(['thread', 'happening'] as const)('gives %s its own filter at all', (category) => {
    expect(railViewFor(category)).toStrictEqual({ category, filter: 'all', search: '' })
  })

  it('defaults to the Characters view', () => {
    expect(DEFAULT_RAIL_VIEW).toStrictEqual({ category: 'character', filter: 'all', search: '' })
  })
})
