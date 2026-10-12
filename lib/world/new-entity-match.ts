import type { CollisionReason, Entity } from '@/lib/db'
import { compareId } from '@/lib/list-modules'

import type { LocationMapView } from './location-map'
import { nameBasis, namesakeBasis } from './namesakes'
import { parentIdOf } from './parent-chain'

const SAME_PARENT = 'same-parent' satisfies CollisionReason

export type PlaceMatch =
  | { kind: 'reuse'; id: string }
  | { kind: 'create'; flag: { partnerId: string; reason: 'same-parent' } | null }

function byAge(a: Entity, b: Entity): number {
  return a.createdAt - b.createdAt || compareId(a.id, b.id)
}

/**
 * piggyback.md → Matching before creating. Reuse goes by `view`, the map the prompt showed: an exact
 * name among the active and staged places it would have hung under `parentId` (null: the root) had
 * it listed every place it left out, a real child first, then the fewest left-out places between,
 * then the oldest. Otherwise the real siblings of any status flag it: an exact retired namesake,
 * then a contained name, then a keyword hit.
 */
export function matchNewLocation(
  candidate: { name: string; parentId: string | null },
  entities: readonly Entity[],
  view: LocationMapView,
): PlaceMatch {
  const locations = entities.filter((e) => e.kind === 'location')

  const [reused] = locations
    .filter((e) => e.status !== 'retired' && nameBasis(candidate.name, e.name) === 'same-name')
    .flatMap((entity) => {
      const hidden = view.hiddenBetween(entity.id, candidate.parentId)
      if (hidden === null) return []
      return [{ entity, real: parentIdOf(entity) === candidate.parentId ? 0 : 1, hidden }]
    })
    .sort((a, b) => a.real - b.real || a.hidden - b.hidden || byAge(a.entity, b.entity))
  if (reused !== undefined) return { kind: 'reuse', id: reused.entity.id }

  const side = { name: candidate.name, keywords: [] }
  const [partner] = locations
    .filter((e) => parentIdOf(e) === candidate.parentId)
    .flatMap((entity) => {
      const basis = namesakeBasis(side, entity)?.basis
      if (basis === 'same-name' && entity.status === 'retired') return [{ entity, rank: 0 }]
      if (basis === 'contained') return [{ entity, rank: 1 }]
      if (basis === 'keyword') return [{ entity, rank: 2 }]
      return []
    })
    .sort((a, b) => a.rank - b.rank || byAge(a.entity, b.entity))
  return {
    kind: 'create',
    flag: partner === undefined ? null : { partnerId: partner.entity.id, reason: SAME_PARENT },
  }
}

/** An item's exact namesakes anywhere on the branch, any status, oldest first. */
export function itemNamesakes(name: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'item' && nameBasis(name, e.name) === 'same-name')
    .sort(byAge)
}
