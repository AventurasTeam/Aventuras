import type { CollisionReason, Entity } from '@/lib/db'
import { compareId } from '@/lib/list-modules'

import { realPlacementOf, type LocationMatchView } from './location-map'
import { nameBasis, namesakeBasis } from './namesakes'
import { samePlacement, type PlacePlacement } from './placement'

const SAME_PARENT = 'same-parent' satisfies CollisionReason
const UNPLACED = 'unplaced' satisfies CollisionReason

type PlaceFlagReason = Extract<CollisionReason, 'same-parent' | 'unplaced'>

export type PlaceMatch =
  /** `place`: the reused row is unplaced, and the writer must place it where the create sits. */
  | { kind: 'reuse'; id: string; place: boolean }
  | { kind: 'create'; flag: { partnerId: string; reason: PlaceFlagReason } | null }

type PlaceCandidate = { name: string; placement: PlacePlacement; keywords?: readonly string[] }

type PlacementAt = (id: string) => PlacePlacement

function byAge(a: Entity, b: Entity): number {
  return a.createdAt - b.createdAt || compareId(a.id, b.id)
}

const sameName = (candidate: PlaceCandidate, entity: Entity): boolean =>
  nameBasis(candidate.name, entity.name) === 'same-name'

/** The flag partner's rank: an exact retired namesake, then a name inside the other, a keyword hit. */
function partnerRank(candidate: PlaceCandidate, entity: Entity): number | null {
  const basis = namesakeBasis(
    { name: candidate.name, keywords: candidate.keywords ?? [] },
    entity,
  )?.basis
  if (basis === 'same-name' && entity.status === 'retired') return 0
  if (basis === 'contained') return 1
  if (basis === 'keyword') return 2
  return null
}

function flagPartner(
  candidate: PlaceCandidate,
  among: readonly Entity[],
  reason: PlaceFlagReason,
): PlaceMatch {
  const [partner] = among
    .flatMap((entity) => {
      const rank = partnerRank(candidate, entity)
      return rank === null ? [] : [{ entity, rank }]
    })
    .sort((a, b) => a.rank - b.rank || byAge(a.entity, b.entity))
  return {
    kind: 'create',
    flag: partner === undefined ? null : { partnerId: partner.entity.id, reason },
  }
}

function matchPlaced(
  candidate: PlaceCandidate,
  parentId: string | null,
  view: LocationMatchView,
  placementAt: PlacementAt,
): PlaceMatch {
  const { locations } = view
  const [reused] = locations
    .filter((e) => e.status !== 'retired' && sameName(candidate, e))
    .flatMap((entity) => {
      const hidden = view.hiddenBetween(entity.id, parentId)
      if (hidden === null) return []
      const real = samePlacement(placementAt(entity.id), candidate.placement) ? 0 : 1
      return [{ entity, real, hidden }]
    })
    .sort((a, b) => a.real - b.real || a.hidden - b.hidden || byAge(a.entity, b.entity))
  if (reused !== undefined) return { kind: 'reuse', id: reused.entity.id, place: false }

  const [unplaced] = locations
    .filter(
      (e) =>
        e.status !== 'retired' && placementAt(e.id).kind === 'unplaced' && sameName(candidate, e),
    )
    .sort(byAge)
  if (unplaced !== undefined) return { kind: 'reuse', id: unplaced.id, place: true }

  const siblings = locations.filter((e) => samePlacement(placementAt(e.id), candidate.placement))
  return flagPartner(candidate, siblings, SAME_PARENT)
}

// data-model.md → LocationState shape: compared by exact name with every place, placed or not.
function matchUnplaced(
  candidate: PlaceCandidate,
  view: LocationMatchView,
  placementAt: PlacementAt,
): PlaceMatch {
  const { locations } = view
  const exact = locations.filter((e) => sameName(candidate, e))
  const live = exact.filter((e) => e.status !== 'retired')
  if (live.length === 1) return { kind: 'reuse', id: live[0].id, place: false }

  const placedLast = (e: Entity) => (placementAt(e.id).kind === 'unplaced' ? 0 : 1)
  const [namesake] = (live.length > 0 ? live : exact).sort(
    (a, b) => placedLast(a) - placedLast(b) || byAge(a, b),
  )
  if (namesake !== undefined)
    return { kind: 'create', flag: { partnerId: namesake.id, reason: UNPLACED } }

  // A partial name elsewhere on the map doesn't flag: the unplaced places stand in for siblings.
  const unplaced = locations.filter((e) => placementAt(e.id).kind === 'unplaced')
  return flagPartner(candidate, unplaced, UNPLACED)
}

/**
 * piggyback.md → Matching before creating. Under a parent or top-level, reuses a non-retired exact
 * namesake the prompt's map (`view`) hangs there, places it left out included, else an active or
 * staged unplaced place of that name (`place: true`); otherwise flags `same-parent` against the
 * real siblings of any status, the candidate's `keywords` counting for a keyword hit. An unplaced
 * candidate follows data-model.md → LocationState shape's third way.
 */
export function matchNewLocation(candidate: PlaceCandidate, view: LocationMatchView): PlaceMatch {
  const placementAt = realPlacementOf(view.locations)
  const { placement } = candidate
  switch (placement.kind) {
    case 'under':
      return matchPlaced(candidate, placement.parentId, view, placementAt)
    case 'top':
      return matchPlaced(candidate, null, view, placementAt)
    case 'unplaced':
      return matchUnplaced(candidate, view, placementAt)
  }
}

/** A new place this reply already settled, where it resolved to. */
export type SettledNewPlace = { name: string; placement: PlacePlacement; id: string }

/**
 * piggyback.md → Matching before creating, within one reply: a second new place with the same name
 * and placement maps to the first; otherwise the place is matched against the existing rows.
 */
export function matchNewPlace(
  candidate: PlaceCandidate,
  settled: readonly SettledNewPlace[],
  view: LocationMatchView,
): PlaceMatch | { kind: 'twin'; id: string } {
  const twin = settled.find(
    (p) =>
      samePlacement(p.placement, candidate.placement) &&
      nameBasis(p.name, candidate.name) === 'same-name',
  )
  return twin === undefined ? matchNewLocation(candidate, view) : { kind: 'twin', id: twin.id }
}

/** An item's exact namesakes anywhere on the branch, any status, oldest first. */
export function itemNamesakes(name: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'item' && nameBasis(name, e.name) === 'same-name')
    .sort(byAge)
}
