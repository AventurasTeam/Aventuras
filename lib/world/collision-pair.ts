import type { CollisionReason, Entity } from '@/lib/db'

import { namesakeBasis, type NamesakeSide } from './namesakes'
import { placementOf, type PlacePlacement } from './placement'

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

/** A row as the pair rule reads it: name, keywords, and a place's placement (`top` otherwise). */
export type PairSide = NamesakeSide & { placement: PlacePlacement }

export function pairSideOf(row: Entity): PairSide {
  const placement: PlacePlacement = row.kind === 'location' ? placementOf(row) : { kind: 'top' }
  return { name: row.name, keywords: row.keywords, placement }
}

/**
 * world.md → Surfacing: a `same-parent` pair needs a shared parent, the top level counting as one;
 * two unplaced places share none. Every other reason passes.
 */
export function sharesRequiredParent(reason: CollisionReason, a: PairSide, b: PairSide): boolean {
  if (reason !== 'same-parent') return true
  if (a.placement.kind === 'under' && b.placement.kind === 'under')
    return a.placement.parentId === b.placement.parentId
  return a.placement.kind === 'top' && b.placement.kind === 'top'
}

/** Still namesakes, and `sharesRequiredParent`. What a write judges before keeping a flag. */
export function stillPaired(reason: CollisionReason, a: PairSide, b: PairSide): boolean {
  return namesakeBasis(a, b) != null && sharesRequiredParent(reason, a, b)
}

/**
 * world.md → Surfacing, the one test of a live flag: it names `partner` (undefined when gone) and
 * the two still pair under `stillPaired`. A flag that fails it is dormant and counts as none.
 */
export function flagStillHolds(row: Entity, partner: Entity | undefined): row is FlaggedEntity {
  return (
    row.nameCollisionFlag === 1 &&
    row.nameCollisionReason != null &&
    partner?.id === row.nameCollisionPartnerId &&
    stillPaired(row.nameCollisionReason, pairSideOf(row), pairSideOf(partner))
  )
}

/** The row whose flag names the other and holds, `first` preferred; null when neither does. */
export function flaggedSideOf(first: Entity, second: Entity): FlaggedEntity | null {
  if (flagStillHolds(first, second)) return first
  if (flagStillHolds(second, first)) return second
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
