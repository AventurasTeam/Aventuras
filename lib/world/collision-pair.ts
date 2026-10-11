import type { CollisionReason, Entity, LocationState } from '@/lib/db'

import { namesakeBasis, type NamesakeSide } from './namesakes'

/**
 * Two distinct rows of one branch and kind, one of whose flags names the other and holds, in the
 * order asked for. Minted only by `collisionPairOf`, so planners taking one skip their own checks.
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

/** A row as the pair rule reads it: its name, keywords, and a place's parent (null otherwise). */
export type PairSide = NamesakeSide & { parentId: string | null }

export function pairSideOf(row: Entity): PairSide {
  const parentId =
    row.kind === 'location'
      ? ((row.state as LocationState | null)?.parent_location_id ?? null)
      : null
  return { name: row.name, keywords: row.keywords, parentId }
}

/** world.md → Surfacing: a `same-parent` pair needs a shared parent; every other reason passes. */
export function sharesRequiredParent(reason: CollisionReason, a: PairSide, b: PairSide): boolean {
  return reason !== 'same-parent' || a.parentId === b.parentId
}

/** Still namesakes, and `sharesRequiredParent`. What a write judges before keeping a flag. */
export function stillPaired(reason: CollisionReason, a: PairSide, b: PairSide): boolean {
  return namesakeBasis(a, b) != null && sharesRequiredParent(reason, a, b)
}

function flagNames(row: Entity, other: Entity): row is FlaggedEntity {
  return (
    row.nameCollisionFlag === 1 &&
    row.nameCollisionPartnerId === other.id &&
    row.nameCollisionReason != null &&
    sharesRequiredParent(row.nameCollisionReason, pairSideOf(row), pairSideOf(other))
  )
}

/**
 * The row whose flag names the other and holds (a `same-parent` flag only while the two share a
 * parent), `first` preferred; null when neither does. Names are not re-checked here.
 */
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
