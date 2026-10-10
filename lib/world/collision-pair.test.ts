import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity, type EntityKind } from '@/lib/db'

import { COLLISION_PAIR_MISS, collisionPairOf } from './collision-pair'

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

const OLDER = row('char_a', 'Kael')
const NEWER = row('char_b', ' KAEL ', {
  nameCollisionFlag: 1,
  nameCollisionPartnerId: 'char_a',
  nameCollisionReason: 'distinct',
})

describe('collisionPairOf', () => {
  it('returns two namesakes in the order asked for, a case and space variant included', () => {
    expect(collisionPairOf([OLDER, NEWER], ['char_b', 'char_a'])).toEqual({
      pair: [NEWER, OLDER],
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
    ['another name', row('char_b', 'Kael the guard')],
    ['another kind', row('loc_b', 'Kael', { kind: 'location' })],
    ['another branch', row('char_b', 'Kael', { branchId: 'b2' })],
  ])('misses a row with %s as not colliding', (_, other) => {
    expect(collisionPairOf([OLDER, other], ['char_a', other.id])).toEqual({
      miss: COLLISION_PAIR_MISS.notColliding,
    })
  })
})
