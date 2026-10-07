import type { Entity } from '@/lib/db'

import { namesakeKey } from './collision-flags'

/**
 * Two distinct rows of one branch with the same `namesakeKey`, in the order asked for. Minted only
 * by `collisionPairOf`, so the planners that take one need no checks of their own.
 */
export type CollisionPair = readonly [Entity, Entity] & { readonly __brand: 'CollisionPair' }

export const COLLISION_PAIR_MISS = {
  sameRow: 'same-row',
  notFound: 'not-found',
  notColliding: 'not-colliding',
} as const

export type CollisionPairMiss =
  | { miss: typeof COLLISION_PAIR_MISS.sameRow }
  | { miss: typeof COLLISION_PAIR_MISS.notFound; id: string }
  | { miss: typeof COLLISION_PAIR_MISS.notColliding }

export type CollisionPairLookup = { pair: CollisionPair } | CollisionPairMiss

/** The rows `ids` name among `entities` (one branch's rows), if they still collide. */
export function collisionPairOf(
  entities: readonly Entity[],
  ids: readonly [string, string],
): CollisionPairLookup {
  if (ids[0] === ids[1]) return { miss: COLLISION_PAIR_MISS.sameRow }
  const first = entities.find((e) => e.id === ids[0])
  if (first == null) return { miss: COLLISION_PAIR_MISS.notFound, id: ids[0] }
  const second = entities.find((e) => e.id === ids[1])
  if (second == null) return { miss: COLLISION_PAIR_MISS.notFound, id: ids[1] }
  if (first.branchId !== second.branchId || namesakeKey(first) !== namesakeKey(second))
    return { miss: COLLISION_PAIR_MISS.notColliding }
  return { pair: [first, second] as readonly [Entity, Entity] as CollisionPair }
}
