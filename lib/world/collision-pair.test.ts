import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity, type EntityKind } from '@/lib/db'

import { COLLISION_PAIR_MISS, collisionPairOf, flaggedSideOf } from './collision-pair'

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

describe('collisionPairOf', () => {
  it('returns a flagged pair in the order asked for, whatever the names', () => {
    expect(collisionPairOf([OLDER, NEWER], ['char_b', 'char_a'])).toEqual({
      pair: [NEWER, OLDER],
    })
    const renamed = row('char_b', 'Brannoc', flaggedWith('char_a'))
    expect(collisionPairOf([OLDER, renamed], ['char_a', 'char_b'])).toEqual({
      pair: [OLDER, renamed],
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
