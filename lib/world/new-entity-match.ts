import type { CollisionReason, Entity } from '@/lib/db'
import { compareId } from '@/lib/list-modules'

import type { LocationMatchView } from './location-map'
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
 * piggyback.md → Matching before creating. Reuses a non-retired exact namesake the prompt's map
 * (`view`) hangs under `parentId` (null: the root), places it left out included; otherwise flags
 * against real siblings of any status, the candidate's `keywords` counting for a keyword hit.
 */
export function matchNewLocation(
  candidate: { name: string; parentId: string | null; keywords?: readonly string[] },
  view: LocationMatchView,
): PlaceMatch {
  const { locations } = view

  const [reused] = locations
    .filter((e) => e.status !== 'retired' && nameBasis(candidate.name, e.name) === 'same-name')
    .flatMap((entity) => {
      const hidden = view.hiddenBetween(entity.id, candidate.parentId)
      if (hidden === null) return []
      return [{ entity, real: parentIdOf(entity) === candidate.parentId ? 0 : 1, hidden }]
    })
    .sort((a, b) => a.real - b.real || a.hidden - b.hidden || byAge(a.entity, b.entity))
  if (reused !== undefined) return { kind: 'reuse', id: reused.entity.id }

  const side = { name: candidate.name, keywords: candidate.keywords ?? [] }
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

/** A new place this reply already settled, under the parent it resolved to. */
export type SettledNewPlace = { name: string; parentId: string | null; id: string }

/**
 * piggyback.md → Matching before creating, within one reply: a second new place with the same name
 * and parent maps to the first; otherwise the place is matched against the existing rows.
 */
export function matchNewPlace(
  candidate: { name: string; parentId: string | null; keywords?: readonly string[] },
  settled: readonly SettledNewPlace[],
  view: LocationMatchView,
): PlaceMatch | { kind: 'twin'; id: string } {
  const twin = settled.find(
    (p) => p.parentId === candidate.parentId && nameBasis(p.name, candidate.name) === 'same-name',
  )
  return twin === undefined ? matchNewLocation(candidate, view) : { kind: 'twin', id: twin.id }
}

/** An item's exact namesakes anywhere on the branch, any status, oldest first. */
export function itemNamesakes(name: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'item' && nameBasis(name, e.name) === 'same-name')
    .sort(byAge)
}
