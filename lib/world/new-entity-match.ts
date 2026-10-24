import type { CollisionReason, Entity } from '@/lib/db'
import { compareId } from '@/lib/list-modules'

import { realPlacementOf, type LocationMatchView } from './location-map'
import { nameBasis, namesakeBasis } from './namesakes'
import type { ParentOf } from './parent-chain'
import { samePlacement, type PlacedPlacement, type PlacePlacement } from './placement'

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

/** Flag partner's rank: an exact retired namesake, then a name inside the other, a keyword hit. */
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

/** A reply's new place: the placement its parent gave, unplaced if dropped, and its row's id. */
export type SettledNewPlace = { name: string; placement: PlacePlacement; id: string }

/** Where this reply's placements put a place. */
export type ReplyPlacements = ReadonlyMap<string, PlacedPlacement>

/** A chain walk's parents: where this reply placed a place, else `stored`. */
export function replyParentOf(placedHere: ReplyPlacements, stored: ParentOf): ParentOf {
  return (id) => {
    const at = placedHere.get(id)
    if (at === undefined) return stored(id)
    return at.kind === 'under' ? at.parentId : null
  }
}

// data-model.md → LocationState shape: compared by exact name with every place, placed or not.
// `earlier`: this reply's own creates of the name, newer than every row as a later reply's are.
function matchUnplaced(
  candidate: PlaceCandidate,
  view: LocationMatchView,
  placementAt: PlacementAt,
  earlier: readonly SettledNewPlace[],
): PlaceMatch {
  const { locations } = view
  const exact = locations.filter((e) => sameName(candidate, e))
  const live = exact.filter((e) => e.status !== 'retired')
  const liveCount = live.length + earlier.length
  const namesakes = [
    ...(liveCount > 0 ? live : exact)
      .sort(byAge)
      .map((e) => ({ id: e.id, unplaced: placementAt(e.id).kind === 'unplaced' })),
    ...earlier.map((p) => ({ id: p.id, unplaced: p.placement.kind === 'unplaced' })),
  ]
  if (liveCount === 1) return { kind: 'reuse', id: namesakes[0].id, place: false }

  const [namesake] = namesakes.sort((a, b) => Number(b.unplaced) - Number(a.unplaced))
  if (namesake !== undefined)
    return { kind: 'create', flag: { partnerId: namesake.id, reason: UNPLACED } }

  // A partial name elsewhere on the map doesn't flag: the unplaced places stand in for siblings.
  const unplaced = locations.filter((e) => placementAt(e.id).kind === 'unplaced')
  return flagPartner(candidate, unplaced, UNPLACED)
}

/**
 * piggyback.md → Matching before creating. Under a parent or top-level: reuse a non-retired exact
 * namesake `view` hangs there, left-out places too, else an unplaced one; else flag `same-parent`.
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
      return matchUnplaced(candidate, view, placementAt, [])
  }
}

/** `place`: an earlier create of this reply left unplaced, which the writer must place. */
export type ReplyPlaceMatch = PlaceMatch | { kind: 'twin'; id: string; place: boolean }

/**
 * piggyback.md → Matching before creating, within one reply: creates match as if applied one at a
 * time, as successive replies' would; `placedHere` holds the placements made so far.
 */
export function matchNewPlace(
  candidate: PlaceCandidate,
  settled: readonly SettledNewPlace[],
  view: LocationMatchView,
  placedHere: ReplyPlacements,
): ReplyPlaceMatch {
  const named = settled.filter((p) => nameBasis(p.name, candidate.name) === 'same-name')
  const twin = named.find((p) => samePlacement(p.placement, candidate.placement))
  if (twin !== undefined) return { kind: 'twin', id: twin.id, place: false }

  const stored = new Set(view.locations.map((e) => e.id))
  const created = new Map<string, SettledNewPlace>()
  // A create's first entry is its own: it sits there unless a takeover placed it since.
  for (const p of named)
    if (!stored.has(p.id) && !created.has(p.id))
      created.set(p.id, { ...p, placement: placedHere.get(p.id) ?? p.placement })
  const earlier = [...created.values()]

  if (candidate.placement.kind === 'unplaced') {
    const match = matchUnplaced(candidate, view, realPlacementOf(view.locations), earlier)
    return match.kind === 'reuse' && created.has(match.id)
      ? { kind: 'twin', id: match.id, place: false }
      : match
  }
  const match = matchNewLocation(candidate, view)
  if (match.kind !== 'create') return match
  const taken = earlier.find((p) => p.placement.kind === 'unplaced')
  return taken === undefined ? match : { kind: 'twin', id: taken.id, place: true }
}

/** An item's exact namesakes anywhere on the branch, any status, oldest first. */
export function itemNamesakes(name: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'item' && nameBasis(name, e.name) === 'same-name')
    .sort(byAge)
}
