import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { CharacterState, Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import {
  branchWorldTime,
  carryingSummary,
  charactersAt,
  chipPreview,
  holdersOf,
  itemsAt,
  lastSeenSpan,
  locationAncestors,
  membersOf,
  visualParts,
} from './overview'

const character = (id: string, name: string, state: Partial<CharacterState>): Entity =>
  makeEntity({
    id,
    kind: 'character',
    name,
    state: {
      visual: {},
      traits: [],
      drives: [],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
      ...state,
    },
  })
const location = (id: string, name: string, parent: string | null) =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent } })
const item = (id: string, name: string, at: string | null) =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: at } })

const CITY = location('loc_city', 'City', null)
const SQUARE = location('loc_square', 'Town Square', 'loc_city')
const SHOP = location('loc_shop', 'Shop', 'loc_square')
const KAEL = character('char_kael', 'Kael', {
  current_location_id: 'loc_shop',
  faction_id: 'fac_watch',
  equipped_items: ['item_blade'],
  inventory: ['item_coin'],
})
const MIRA = character('char_mira', 'Mira', {
  current_location_id: 'loc_shop',
  inventory: ['item_coin'],
})
const COIN = item('item_coin', 'Silver coin', null)
const KEY = item('item_key', 'Old key', 'loc_shop')
const ALL = [CITY, SQUARE, SHOP, KAEL, MIRA, COIN, KEY]

describe('Overview derivations', () => {
  it('walks the parent chain nearest first', () => {
    expect(locationAncestors('loc_shop', ALL).map((e) => e.name)).toEqual(['Town Square', 'City'])
  })

  it('derives characters and items at a location, sorted by name', () => {
    expect(charactersAt('loc_shop', ALL).map((e) => e.name)).toEqual(['Kael', 'Mira'])
    expect(itemsAt('loc_shop', ALL).map((e) => e.name)).toEqual(['Old key'])
  })

  it('derives every holder of an item from equipped and carried lists', () => {
    expect(holdersOf('item_coin', ALL).map((e) => e.name)).toEqual(['Kael', 'Mira'])
    expect(holdersOf('item_blade', ALL).map((e) => e.name)).toEqual(['Kael'])
  })

  it('counts faction members', () => {
    expect(membersOf('fac_watch', ALL).map((e) => e.name)).toEqual(['Kael'])
  })

  it('picks the first two populated visual fields in canon order', () => {
    expect(visualParts({ physique: ' ', face: 'scarred', eyes: 'grey', attire: 'cloak' })).toEqual([
      'scarred',
      'grey',
    ])
  })

  it('previews chips with an overflow count', () => {
    expect(chipPreview(['a', 'b', 'c', 'd', ' '])).toEqual({ shown: ['a', 'b', 'c'], more: 1 })
  })

  it('summarises carrying by top quantities and list counts', () => {
    expect(
      carryingSummary({
        ...(KAEL.state as CharacterState),
        stackables: { gold: 200, rations: 7, silver: 30, arrows: 1 },
      }),
    ).toEqual({
      stackables: [
        { key: 'gold', count: 200 },
        { key: 'silver', count: 30 },
        { key: 'rations', count: 7 },
      ],
      equipped: 1,
      carried: 1,
    })
  })

  it('measures last seen in whole in-world days, omitting a span that runs backwards', () => {
    const seen = { entryId: 'e_1', locationId: null, worldTime: 1000 }
    expect(lastSeenSpan(seen, 1000 + 2 * 86_400 + 60, EARTH_GREGORIAN)).toEqual({
      tier: 'day',
      count: 2,
    })
    expect(lastSeenSpan(seen, 500, EARTH_GREGORIAN)).toBeNull()
    expect(lastSeenSpan(null, 5000, EARTH_GREGORIAN)).toBeNull()
  })

  it('reads the branch world time from the narrative tail, past a system banner', () => {
    expect(
      branchWorldTime([
        { id: 'e_1', kind: 'ai_reply', position: 1, metadata: { worldTime: 60 } },
        { id: 'e_2', kind: 'user_action', position: 2, metadata: null },
        { id: 'e_3', kind: 'system', position: 3, metadata: { worldTime: 999 } },
      ]),
    ).toBe(60)
  })
})
