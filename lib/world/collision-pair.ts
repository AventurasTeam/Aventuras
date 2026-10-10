import type { CollisionReason, Entity } from '@/lib/db'

/**
 * Two distinct rows of one branch and kind, one of whose flags names the other, in the order asked
 * for. Minted only by `collisionPairOf`, so the planners that take one need no checks of their own.
 */
export type CollisionPair = readonly [Entity, Entity] & { readonly __brand: 'CollisionPair' }

export const COLLISION_PAIR_MISS = {
  sameRow: 'same-row',
  notFound: 'not-found',
  notFlagged: 'not-flagged',
} as const

export type CollisionPairMiss =
  | { miss: typeof COLLISION_PAIR_MISS.sameRow }
  | { miss: typeof COLLISION_PAIR_MISS.notFound; id: string }
  | { miss: typeof COLLISION_PAIR_MISS.notFlagged }

export type CollisionPairLookup = { pair: CollisionPair } | CollisionPairMiss

/** A row whose flag is set, narrowed so its partner and reason need no null checks. */
export type FlaggedEntity = Entity & {
  nameCollisionFlag: 1
  nameCollisionPartnerId: string
  nameCollisionReason: CollisionReason
}

function flagNames(row: Entity, other: Entity): row is FlaggedEntity {
  return (
    row.nameCollisionFlag === 1 &&
    row.nameCollisionPartnerId === other.id &&
    row.nameCollisionReason != null
  )
}

/** The row whose flag names the other, `first` preferred; null when neither does. */
export function flaggedSideOf(first: Entity, second: Entity): FlaggedEntity | null {
  if (flagNames(first, second)) return first
  if (flagNames(second, first)) return second
  return null
}

/** The rows `ids` name among `entities` (one branch's rows), if they are still a flagged pair. */
export function collisionPairOf(
  entities: readonly Entity[],
  ids: readonly [string, string],
): CollisionPairLookup {
  if (ids[0] === ids[1]) return { miss: COLLISION_PAIR_MISS.sameRow }
  const first = entities.find((e) => e.id === ids[0])
  if (first == null) return { miss: COLLISION_PAIR_MISS.notFound, id: ids[0] }
  const second = entities.find((e) => e.id === ids[1])
  if (second == null) return { miss: COLLISION_PAIR_MISS.notFound, id: ids[1] }
  if (
    first.branchId !== second.branchId ||
    first.kind !== second.kind ||
    flaggedSideOf(first, second) == null
  )
    return { miss: COLLISION_PAIR_MISS.notFlagged }
  return { pair: [first, second] as readonly [Entity, Entity] as CollisionPair }
}
