import type { CollisionReason, Entity } from '@/lib/db'
import { compareId } from '@/lib/list-modules'

import { stateOf } from './entity-draft'
import { nameBasis, namesakeBasis } from './namesakes'

const SAME_PARENT = 'same-parent' satisfies CollisionReason

export type PlaceMatch =
  | { kind: 'reuse'; id: string }
  | { kind: 'create'; flag: { partnerId: string; reason: 'same-parent' } | null }

function byAge(a: Entity, b: Entity): number {
  return a.createdAt - b.createdAt || compareId(a.id, b.id)
}

/**
 * piggyback.md → Matching before creating: a place compares only with its siblings, the active and
 * staged locations under `parentId` (null: the root), whatever their injection mode. An exact name
 * reuses the oldest; a partial one creates flagged, a contained name ranked before a keyword hit.
 */
export function matchNewLocation(
  candidate: { name: string; parentId: string | null },
  entities: readonly Entity[],
): PlaceMatch {
  const siblings = entities.filter(
    (e) =>
      e.kind === 'location' &&
      e.status !== 'retired' &&
      (stateOf(e, 'location').parent_location_id ?? null) === candidate.parentId,
  )
  const [exact] = siblings
    .filter((e) => nameBasis(candidate.name, e.name) === 'same-name')
    .sort(byAge)
  if (exact !== undefined) return { kind: 'reuse', id: exact.id }

  const side = { name: candidate.name, keywords: [] }
  const [partner] = siblings
    .flatMap((entity) => {
      const basis = namesakeBasis(side, entity)?.basis
      if (basis === 'contained') return [{ entity, rank: 0 }]
      if (basis === 'keyword') return [{ entity, rank: 1 }]
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
