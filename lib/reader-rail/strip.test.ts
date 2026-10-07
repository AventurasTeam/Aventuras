import { describe, expect, it } from 'vitest'

import type { RecentlyClassified, RowCategory, SignalEntity } from '@/lib/row-signals'

import { aggregateTint, formatStripCount, railStripModel } from './strip'

const ENTITIES: SignalEntity[] = [
  { id: 'char_a', kind: 'character' },
  { id: 'char_b', kind: 'character' },
  { id: 'char_offstage', kind: 'character' },
  { id: 'item_1', kind: 'item' },
  { id: 'loc_1', kind: 'location' },
  { id: 'fac_1', kind: 'faction' },
]
const NO_TINT: ReadonlyMap<RowCategory, RecentlyClassified> = new Map()

describe('railStripModel', () => {
  it('counts in-scene characters and items, never the location or a faction', () => {
    const model = railStripModel({
      inScene: new Set(['char_a', 'char_b', 'item_1', 'loc_1', 'fac_1']),
      entities: ENTITIES,
      byCategory: NO_TINT,
    })
    expect(model.counted.map((cell) => [cell.category, cell.count])).toEqual([
      ['character', 2],
      ['item', 1],
    ])
  })

  it('counts zero when nothing of the kind is in scene', () => {
    const model = railStripModel({ inScene: new Set(), entities: ENTITIES, byCategory: NO_TINT })
    expect(model.counted.map((cell) => cell.count)).toEqual([0, 0])
  })

  it('counts nothing for an in-scene id with no entity row', () => {
    const model = railStripModel({
      inScene: new Set(['char_a', 'ghost']),
      entities: ENTITIES,
      byCategory: NO_TINT,
    })
    expect(model.counted[0].count).toBe(1)
  })

  it('keeps the raw count above nine; only formatting caps it', () => {
    const crowd: SignalEntity[] = Array.from({ length: 12 }, (_, i) => ({
      id: `char_${i}`,
      kind: 'character',
    }))
    const model = railStripModel({
      inScene: new Set(crowd.map((e) => e.id)),
      entities: crowd,
      byCategory: NO_TINT,
    })
    expect(model.counted[0].count).toBe(12)
  })

  it('orders the cells character, item, then location, faction', () => {
    const model = railStripModel({ inScene: new Set(), entities: ENTITIES, byCategory: NO_TINT })
    expect(model.counted.map((cell) => cell.category)).toEqual(['character', 'item'])
    expect(model.quickAccess.map((cell) => cell.category)).toEqual(['location', 'faction'])
  })

  it('tints each cell from its own kind only', () => {
    const model = railStripModel({
      inScene: new Set(),
      entities: ENTITIES,
      byCategory: new Map<RowCategory, RecentlyClassified>([
        ['character', 'fresh'],
        ['item', 'fading'],
        ['faction', 'fresh'],
        ['lore', 'fresh'],
      ]),
    })
    expect(model.counted.map((cell) => cell.tint)).toEqual(['fresh', 'fading'])
    expect(model.quickAccess.map((cell) => cell.tint)).toEqual([undefined, 'fresh'])
  })
})

describe('formatStripCount', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [9, '9'],
    [10, '9+'],
    [12, '9+'],
  ])('renders %i as %s', (count, text) => {
    expect(formatStripCount(count)).toBe(text)
  })
})

describe('aggregateTint', () => {
  it('is undefined when nothing is tinted', () => {
    expect(aggregateTint(new Map())).toBeUndefined()
  })

  it('is fading when every tinted category is fading', () => {
    expect(
      aggregateTint(
        new Map<RowCategory, RecentlyClassified>([
          ['lore', 'fading'],
          ['thread', 'fading'],
        ]),
      ),
    ).toBe('fading')
  })

  it('is fresh when any category is fresh, wherever it sits in the map', () => {
    expect(
      aggregateTint(
        new Map<RowCategory, RecentlyClassified>([
          ['lore', 'fading'],
          ['happening', 'fresh'],
        ]),
      ),
    ).toBe('fresh')
    expect(
      aggregateTint(
        new Map<RowCategory, RecentlyClassified>([
          ['happening', 'fresh'],
          ['lore', 'fading'],
        ]),
      ),
    ).toBe('fresh')
  })
})
