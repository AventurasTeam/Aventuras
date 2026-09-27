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

const character = (
  id: string,
  name: string,
  state: Partial<CharacterState>,
  overrides: Partial<Entity> = {},
): Entity =>
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
    ...overrides,
  })
const location = (id: string, name: string, parent: string | null) =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent } })
const item = (id: string, name: string, at: string | null) =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: at } })

const CITY = location('loc_city', 'City', null)
const SQUARE = location('loc_square', 'Town Square', 'loc_city')
const SHOP = location('loc_shop', 'Shop', 'loc_square')
const LOC_ORPHAN = location('loc_orphan', 'Orphan Loc', 'loc_missing')
const LOC_MISPARENTED = location('loc_bad_parent', 'Bad Parent Loc', 'char_kael')
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
// Same name, ids in the opposite order to createdAt — pins the createdAt tie-break over compareId.
const ASH_A = character('char_ash_a', 'Ash', { current_location_id: 'loc_shop' }, { createdAt: 2 })
const ASH_Z = character('char_ash_z', 'Ash', { current_location_id: 'loc_shop' }, { createdAt: 1 })
const COIN = item('item_coin', 'Silver coin', null)
const KEY = item('item_key', 'Old key', 'loc_shop')
const ALL = [CITY, SQUARE, SHOP, LOC_ORPHAN, LOC_MISPARENTED, MIRA, KAEL, ASH_A, ASH_Z, COIN, KEY]

describe('Overview derivations', () => {
  it('walks the parent chain nearest first', () => {
    expect(locationAncestors('loc_shop', ALL).map((e) => e.name)).toEqual(['Town Square', 'City'])
  })

  it('excludes a non-location ancestor', () => {
    expect(locationAncestors('loc_bad_parent', ALL)).toEqual([])
  })

  it('excludes a dangling ancestor id', () => {
    expect(locationAncestors('loc_orphan', ALL)).toEqual([])
  })

  it('derives characters and items at a location, sorted by name, ties broken by createdAt then id', () => {
    expect(charactersAt('loc_shop', ALL).map((e) => e.id)).toEqual([
      'char_ash_z',
      'char_ash_a',
      'char_kael',
      'char_mira',
    ])
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
    expect(visualParts({ attire: 'cloak', eyes: 'grey', face: 'scarred', physique: ' ' })).toEqual([
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
        equipped_items: ['item_blade', 'item_key'],
        stackables: { gold: 200, rations: 7, silver: 30, arrows: 1 },
      }),
    ).toEqual({
      stackables: [
        { key: 'gold', count: 200 },
        { key: 'silver', count: 30 },
        { key: 'rations', count: 7 },
      ],
      equipped: 2,
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

  it('reads a world time of 0 for an empty branch', () => {
    expect(branchWorldTime([])).toBe(0)
  })
})
