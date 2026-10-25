import { describe, expect, expectTypeOf, it } from 'vitest'

import { emptyEntityState, type Entity, type EntityKind } from '@/lib/db'

import {
  COLLISION_PAIR_MISS,
  collisionPairOf,
  flaggedSideOf,
  flagStillHolds,
  pairSideOf,
  sharesRequiredParent,
  stillPaired,
  type FlaggedEntity,
  type PairSide,
} from './collision-pair'

function row(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  const kind: EntityKind = overrides.kind ?? 'character'
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: emptyEntityState(kind),
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const flaggedWith = (partnerId: string, reason: Entity['nameCollisionReason'] = 'distinct') => ({
  nameCollisionFlag: 1,
  nameCollisionPartnerId: partnerId,
  nameCollisionReason: reason,
})

const place = (
  id: string,
  name: string,
  parentId: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  row(id, name, { kind: 'location', state: { parent_location_id: parentId }, ...overrides })

const under = (parentId: string) => ({ kind: 'under', parentId }) as const
const TOP = { kind: 'top' } as const
const UNPLACED = { kind: 'unplaced' } as const

const OLDER = row('char_a', 'Kael')
const NEWER = row('char_b', 'Kael Stormborn', flaggedWith('char_a', 'ambiguous'))

describe('flaggedSideOf', () => {
  it('returns the row whose flag names the other, whichever side it is on', () => {
    expect(flaggedSideOf(NEWER, OLDER)).toBe(NEWER)
    expect(flaggedSideOf(OLDER, NEWER)).toBe(NEWER)
  })

  it('prefers the first row when both flags name each other', () => {
    const mutual = row('char_a', 'Kael', flaggedWith('char_b'))
    expect(flaggedSideOf(mutual, NEWER)).toBe(mutual)
    expect(flaggedSideOf(NEWER, mutual)).toBe(NEWER)
  })

  it('returns null when neither flag names the other, a flag naming a third row included', () => {
    expect(flaggedSideOf(OLDER, row('char_c', 'Kael'))).toBeNull()
    expect(flaggedSideOf(OLDER, row('char_c', 'Kael', flaggedWith('char_x')))).toBeNull()
  })
})

describe('flagStillHolds', () => {
  // Its false result turns on the partner, so it can't narrow the row away.
  it('leaves a flagged row typed as flagged when its partner is gone', () => {
    const side = flaggedSideOf(NEWER, OLDER)
    if (side == null) throw new Error('expected NEWER’s flag on OLDER to hold')
    if (flagStillHolds(side, undefined)) throw new Error('a flag whose partner is gone held')
    expectTypeOf(side).toEqualTypeOf<FlaggedEntity>()
  })
})

describe('collisionPairOf', () => {
  it('returns a flagged pair in the order asked for', () => {
    expect(collisionPairOf([OLDER, NEWER], ['char_b', 'char_a'])).toEqual({
      pair: [NEWER, OLDER],
    })
  })

  it('misses a flagged pair that are no longer namesakes', () => {
    const renamed = row('char_b', 'Brannoc', flaggedWith('char_a'))
    expect(collisionPairOf([OLDER, renamed], ['char_a', 'char_b'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
  })

  it('misses one row named twice', () => {
    expect(collisionPairOf([OLDER, NEWER], ['char_a', 'char_a'])).toEqual({
      miss: COLLISION_PAIR_MISS.sameRow,
    })
  })

  it('misses with the first id it cannot find', () => {
    expect(collisionPairOf([NEWER], ['char_a', 'char_x'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFound,
      id: 'char_a',
    })
    expect(collisionPairOf([OLDER], ['char_a', 'char_b'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFound,
      id: 'char_b',
    })
  })

  it.each([
    ['two unflagged namesakes', row('char_b', 'Kael')],
    ['a flag naming a third row', row('char_b', 'Kael', flaggedWith('char_x'))],
    ['another kind', row('loc_b', 'Kael', { kind: 'location', ...flaggedWith('char_a') })],
    ['another branch', row('char_b', 'Kael', { branchId: 'b2', ...flaggedWith('char_a') })],
  ])('misses %s as not flagged', (_, other) => {
    expect(collisionPairOf([OLDER, other], ['char_a', other.id])).toEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
  })
})

describe('pairSideOf', () => {
  it("reads a place's placement, and top-level for another kind", () => {
    expect(
      pairSideOf(place('loc_s', 'The Stalls', 'loc_p', { keywords: ['the stalls'] })),
    ).toStrictEqual({ name: 'The Stalls', keywords: ['the stalls'], placement: under('loc_p') })
    expect(pairSideOf(place('loc_r', 'The Quay', null)).placement).toEqual(TOP)
    expect(
      pairSideOf(row('loc_n', 'Nowhere', { kind: 'location', state: null })).placement,
    ).toEqual(TOP)
    expect(
      pairSideOf(
        row('loc_u', 'Varn', {
          kind: 'location',
          state: { parent_location_id: null, unplaced: true },
        }),
      ).placement,
    ).toEqual(UNPLACED)
    expect(pairSideOf(OLDER).placement).toEqual(TOP)
  })
})

describe('sharesRequiredParent', () => {
  const a: PairSide = { name: 'The Market', keywords: [], placement: under('loc_p') }
  const b: PairSide = { name: 'The Quay', keywords: [], placement: under('loc_p') }

  it('reads the parent clause alone, names aside', () => {
    expect(sharesRequiredParent('same-parent', a, b)).toBe(true)
    expect(sharesRequiredParent('same-parent', a, { ...b, placement: under('loc_q') })).toBe(false)
    expect(sharesRequiredParent('same-parent', a, { ...b, placement: TOP })).toBe(false)
    expect(sharesRequiredParent('alike', a, { ...b, placement: under('loc_q') })).toBe(true)
  })

  it('counts the top level as one parent', () => {
    expect(
      sharesRequiredParent('same-parent', { ...a, placement: TOP }, { ...b, placement: TOP }),
    ).toBe(true)
  })

  // world.md → Surfacing: a `same-parent` pair is one only while the two share a parent.
  it('never pairs an unplaced place same-parent, beside another unplaced one or anywhere', () => {
    const unplacedA = { ...a, placement: UNPLACED }
    expect(sharesRequiredParent('same-parent', unplacedA, { ...b, placement: UNPLACED })).toBe(
      false,
    )
    expect(sharesRequiredParent('same-parent', unplacedA, { ...b, placement: TOP })).toBe(false)
    expect(sharesRequiredParent('same-parent', unplacedA, b)).toBe(false)
  })

  it('pairs an unplaced flag whatever the two placements', () => {
    expect(
      sharesRequiredParent('unplaced', { ...a, placement: UNPLACED }, { ...b, placement: TOP }),
    ).toBe(true)
    expect(sharesRequiredParent('unplaced', { ...a, placement: UNPLACED }, b)).toBe(true)
  })
})

describe('stillPaired', () => {
  const side = (name: string, parentId: string | null): PairSide => ({
    name,
    keywords: [],
    placement: parentId === null ? TOP : under(parentId),
  })

  it('needs a shared parent only for a same-parent flag, the root counting as one parent', () => {
    expect(
      stillPaired('same-parent', side('The Market', 'loc_p'), side('The Market Stalls', 'loc_p')),
    ).toBe(true)
    expect(
      stillPaired('same-parent', side('The Market', null), side('The Market Stalls', null)),
    ).toBe(true)
    expect(
      stillPaired('same-parent', side('The Market', 'loc_p'), side('The Market Stalls', 'loc_q')),
    ).toBe(false)
    expect(
      stillPaired('same-parent', side('The Market', null), side('The Market Stalls', 'loc_p')),
    ).toBe(false)
    expect(
      stillPaired('distinct', side('The Market', 'loc_p'), side('The Market Stalls', 'loc_q')),
    ).toBe(true)
  })

  it('needs the two to stay namesakes under every reason', () => {
    expect(stillPaired('same-parent', side('The Market', 'loc_p'), side('The Quay', 'loc_p'))).toBe(
      false,
    )
    expect(stillPaired('distinct', side('Kael', null), side('Brannoc', null))).toBe(false)
  })
})

describe('collisionPairOf — the same-parent clause', () => {
  const MARKET = place('loc_m', 'The Market', 'loc_p')
  const stallsUnder = (
    parentId: string | null,
    reason: Entity['nameCollisionReason'] = 'same-parent',
  ) => place('loc_s', 'The Market Stalls', parentId, flaggedWith('loc_m', reason))

  it('pairs a same-parent flag while the two share a parent, the root included', () => {
    const stalls = stallsUnder('loc_p')
    expect(collisionPairOf([MARKET, stalls], ['loc_s', 'loc_m'])).toEqual({
      pair: [stalls, MARKET],
    })
    const rootMarket = place('loc_m', 'The Market', null)
    const rootStalls = stallsUnder(null)
    expect(collisionPairOf([rootMarket, rootStalls], ['loc_s', 'loc_m'])).toEqual({
      pair: [rootStalls, rootMarket],
    })
  })

  it.each([
    ['under two parents', 'loc_q'],
    ['between the root and a parent', null],
  ])('misses a same-parent pair split %s, asked either way round', (_, parentId) => {
    const split = stallsUnder(parentId)
    expect(collisionPairOf([MARKET, split], ['loc_s', 'loc_m'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
    expect(collisionPairOf([MARKET, split], ['loc_m', 'loc_s'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
  })

  it('misses a same-parent pair of two unplaced places, which share no parent', () => {
    const unplacedState = { parent_location_id: null, unplaced: true as const }
    const market = place('loc_m', 'The Market', null, { state: unplacedState })
    const stalls = place('loc_s', 'The Market Stalls', null, {
      ...flaggedWith('loc_m', 'same-parent'),
      state: unplacedState,
    })
    expect(collisionPairOf([market, stalls], ['loc_s', 'loc_m'])).toEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
  })

  it('pairs a place flagged for another reason whatever its parent', () => {
    const stalls = stallsUnder('loc_q', 'distinct')
    expect(collisionPairOf([MARKET, stalls], ['loc_s', 'loc_m'])).toEqual({
      pair: [stalls, MARKET],
    })
  })

  it('reads the flag that holds when both rows name each other', () => {
    const split = stallsUnder('loc_q')
    const naming = place('loc_m', 'The Market', 'loc_p', flaggedWith('loc_s', 'distinct'))
    expect(flaggedSideOf(split, naming)).toBe(naming)
    expect(collisionPairOf([naming, split], ['loc_s', 'loc_m'])).toEqual({ pair: [split, naming] })
  })
})
