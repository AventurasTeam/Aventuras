import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { itemNamesakes, matchNewLocation } from './new-entity-match'

const place = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })
const thing = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: null }, ...overrides })

const PLAIN = { kind: 'create', flag: null }
const flaggedWith = (partnerId: string) => ({
  kind: 'create',
  flag: { partnerId, reason: 'same-parent' },
})

const MARKET = place('loc_market', 'The Drowned Market', 'loc_hollow')

describe('matchNewLocation', () => {
  it('reuses an exact sibling across case and spacing', () => {
    expect(
      matchNewLocation({ name: '  the DROWNED market ', parentId: 'loc_hollow' }, [MARKET]),
    ).toEqual({ kind: 'reuse', id: 'loc_market' })
  })

  it('compares a root candidate with root rows, and never across parents', () => {
    const rootMarket = place('loc_root', 'The Drowned Market', null)
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: null }, [MARKET, rootMarket]),
    ).toEqual({ kind: 'reuse', id: 'loc_root' })
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: 'loc_elsewhere' }, [
        MARKET,
        rootMarket,
      ]),
    ).toEqual(PLAIN)
  })

  it('reuses the oldest of several exact siblings, then the lowest id', () => {
    const entities = [
      place('loc_new', 'Mill', null, { createdAt: 9 }),
      place('loc_z', 'Mill', null, { createdAt: 3 }),
      place('loc_b', 'mill', null, { createdAt: 3 }),
    ]
    expect(matchNewLocation({ name: 'Mill', parentId: null }, entities)).toEqual({
      kind: 'reuse',
      id: 'loc_b',
    })
  })

  it('reuses a disabled or a staged sibling, and ignores a retired one', () => {
    const candidate = { name: 'The Drowned Market', parentId: 'loc_hollow' }
    expect(matchNewLocation(candidate, [{ ...MARKET, injectionMode: 'disabled' }])).toEqual({
      kind: 'reuse',
      id: 'loc_market',
    })
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'staged' }])).toEqual({
      kind: 'reuse',
      id: 'loc_market',
    })
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'retired' }])).toEqual(PLAIN)
  })

  it('flags same-parent a sibling whose name sits inside the candidate', () => {
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, [MARKET]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('flags a sibling whose keywords hold the candidate name', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the customs house'],
    })
    expect(
      matchNewLocation({ name: 'The Customs House', parentId: 'loc_hollow' }, [office]),
    ).toEqual(flaggedWith('loc_office'))
  })

  it('pairs with a contained name before an older keyword hit', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the drowned market stalls'],
      createdAt: 1,
    })
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, [
        office,
        { ...MARKET, createdAt: 9 },
      ]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('pairs with the oldest partial sibling, then the lowest id', () => {
    const entities = [
      place('loc_new', 'Market', 'loc_hollow', { createdAt: 9 }),
      place('loc_z', 'Drowned Market', 'loc_hollow', { createdAt: 2 }),
      place('loc_b', 'Market Stalls', 'loc_hollow', { createdAt: 2 }),
    ]
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, entities),
    ).toEqual(flaggedWith('loc_b'))
  })

  it('ignores a retired, non-location or other-parent row on the partial path', () => {
    const entities = [
      place('loc_retired', 'Market', 'loc_hollow', { status: 'retired' }),
      thing('item_stalls', 'Market Stalls'),
      place('loc_other', 'Drowned Market', 'loc_elsewhere'),
    ]
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, entities),
    ).toEqual(PLAIN)
  })

  it('reuses an exact sibling ahead of an older partial one', () => {
    const partial = place('loc_old', 'Market', 'loc_hollow', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: 'loc_hollow' }, [
        partial,
        { ...MARKET, createdAt: 9 },
      ]),
    ).toEqual({ kind: 'reuse', id: 'loc_market' })
  })

  it('compares only locations', () => {
    const entities = [
      thing('item_lantern', 'Lantern'),
      makeEntity({ id: 'char_lantern', kind: 'character', name: 'Lantern' }),
    ]
    expect(matchNewLocation({ name: 'Lantern', parentId: null }, entities)).toEqual(PLAIN)
  })

  it('creates plain beside unrelated siblings', () => {
    expect(matchNewLocation({ name: 'Lighthouse', parentId: 'loc_hollow' }, [MARKET])).toEqual(
      PLAIN,
    )
  })
})

describe('itemNamesakes', () => {
  it('returns every exactly named item, any status, oldest first', () => {
    const entities = [
      thing('item_a', 'Sword', { createdAt: 5 }),
      thing('item_b', '  sword ', { createdAt: 2, status: 'retired' }),
      thing('item_c', 'SWORD', { createdAt: 3, status: 'staged' }),
      thing('item_d', 'long sword', { createdAt: 1 }),
      place('loc_sword', 'Sword', null, { createdAt: 1 }),
    ]
    expect(itemNamesakes('sword', entities).map((e) => e.id)).toEqual([
      'item_b',
      'item_c',
      'item_a',
    ])
  })

  it('breaks an age tie by id', () => {
    const entities = [
      thing('item_z', 'key', { createdAt: 4 }),
      thing('item_a', 'Key', { createdAt: 4 }),
    ]
    expect(itemNamesakes('key', entities).map((e) => e.id)).toEqual(['item_a', 'item_z'])
  })

  it('is empty with no exact namesake', () => {
    expect(itemNamesakes('dagger', [thing('item_a', 'Sword')])).toEqual([])
  })
})
