import type { Entity } from '@/lib/db'
import { blankToNull, oneLine } from '@/lib/text'

import { byName, locationAncestors } from './overview'
import { parentChainIds, parentOfLocations } from './parent-chain'
import { placeModes } from './place-modes'
import { realPlacementOf, type PlacePlacement } from './placement'

/** A retired row carries no id: the map offers none to move the scene to or nest a place under. */
export type LocationMapRow =
  | { retired: false; id: string; name: string; depth: number; retiredReason: null }
  | { retired: true; id: null; name: string; depth: number; retiredReason: string | null }

export type PlaceTreeRow = { entity: Entity; depth: number }

/**
 * Where the map hangs a place, listed or not, and how many left-out places lie in between.
 * `unplaced`: with no listed ancestor, it hangs at the root of the Unplaced group, not the map's.
 */
export type MapAnchor = { hidden: number } & (
  | { parentId: string; unplaced: false }
  | { parentId: null; unplaced: boolean }
)

export type LocationMapView = {
  rows: LocationMapRow[]
  /** Unplaced places, each followed by its subtree, depth relative to the group. */
  unplacedRows: LocationMapRow[]
  /** Every location the view was built from, of any status, listed or not. */
  locations: readonly Entity[]
  anchorOf: (id: string) => MapAnchor
  /**
   * Left-out places between a place and `parentId` (null: root), or null if the map wouldn't hang
   * it there; an unplaced place hangs at no root. A left-out `parentId` counts as listed, since
   * `# In scene`, the fallback's roster or a reused handle can name one.
   */
  hiddenBetween: (id: string, parentId: string | null) => number | null
}

/** The place-matching half of a view: which places exist, and where a place hangs. */
export type LocationMatchView = Pick<LocationMapView, 'locations' | 'hiddenBetween'>

/** classifier.md → Mentioned places: the tree, and the unplaced places with what lies in them. */
export type PlaceTree = { tree: PlaceTreeRow[]; unplaced: PlaceTreeRow[] }

const UNPLACED_ROOT = Symbol('unplaced')

/** What a place hangs from: a parent's id, the tree's root (null), or the Unplaced group's. */
type Hang = string | null | typeof UNPLACED_ROOT

const hangOf = (placement: PlacePlacement): Hang =>
  placement.kind === 'under' ? placement.parentId : placement.kind === 'top' ? null : UNPLACED_ROOT

// Places on a parent loop never reach a root: they're listed at the tree's, flat, and in `atRoot`.
function nest(
  places: readonly Entity[],
  hangFrom: (id: string) => Hang,
): { tree: PlaceTreeRow[]; unplaced: PlaceTreeRow[]; atRoot: ReadonlySet<string> } {
  const childrenOf = new Map<Hang, Entity[]>()
  for (const place of places) {
    const hang = hangFrom(place.id)
    const siblings = childrenOf.get(hang)
    if (siblings === undefined) childrenOf.set(hang, [place])
    else siblings.push(place)
  }

  const reached = new Set<string>()
  const walk = (hang: Hang, depth: number, out: PlaceTreeRow[]): void => {
    for (const place of (childrenOf.get(hang) ?? []).sort(byName)) {
      reached.add(place.id)
      out.push({ entity: place, depth })
      walk(place.id, depth + 1, out)
    }
  }
  const tree: PlaceTreeRow[] = []
  const unplaced: PlaceTreeRow[] = []
  walk(null, 0, tree)
  walk(UNPLACED_ROOT, 0, unplaced)
  const unreached = places.filter((e) => !reached.has(e.id)).sort(byName)
  for (const place of unreached) tree.push({ entity: place, depth: 0 })
  return { tree, unplaced, atRoot: new Set(unreached.map((e) => e.id)) }
}

/**
 * classifier.md → Mentioned places: every place on the branch, whatever its status or mode, under
 * its real parent; an unplaced place, and what lies inside it, in a group of its own.
 */
export function placeTree(entities: readonly Entity[]): PlaceTree {
  const locations = entities.filter((e) => e.kind === 'location')
  const placementAt = realPlacementOf(locations)
  const { tree, unplaced } = nest(locations, (id) => hangOf(placementAt(id)))
  return { tree, unplaced }
}

/** A view that hides nothing: a place hangs only under its real parent, or at root if top-level. */
export function unhiddenLocationView(entities: readonly Entity[]): LocationMatchView {
  const locations = entities.filter((e) => e.kind === 'location')
  const placementAt = realPlacementOf(locations)
  const ids = new Set(locations.map((e) => e.id))
  return {
    locations,
    hiddenBetween: (id, parentId) =>
      ids.has(id) && hangOf(placementAt(id)) === parentId ? 0 : null,
  }
}

function mapRow(location: Entity, depth: number): LocationMapRow {
  const { id, name } = location
  return location.status === 'retired'
    ? {
        retired: true,
        id: null,
        name,
        depth,
        // Each row is one line of the tree: a stored reason may span several.
        retiredReason: blankToNull(oneLine(location.retiredReason ?? '')),
      }
    : { retired: false, id, name, depth, retiredReason: null }
}

/**
 * piggyback.md → What the writer sees. Effectively disabled places are left out, bar the current
 * location; a left-out place's listed children hang under its nearest listed ancestor.
 */
export function locationMapView(
  entities: readonly Entity[],
  currentLocationId: string | null,
): LocationMapView {
  const modes = placeModes(entities, currentLocationId)
  const locations = entities.filter((e) => e.kind === 'location')
  const locationIds = new Set(locations.map((e) => e.id))
  const listed = locations.filter((e) => !modes.isDisabled(e.id))
  const listedIds = new Set(listed.map((e) => e.id))
  const parentOf = parentOfLocations(entities)
  const placementAt = realPlacementOf(locations)
  // With no listed ancestor, the top of the place's chain says which root it hangs at.
  const chainAnchor = (id: string): MapAnchor => {
    let hidden = 0
    let top = id
    for (const ancestorId of parentChainIds(id, parentOf)) {
      if (listedIds.has(ancestorId)) return { parentId: ancestorId, hidden, unplaced: false }
      if (locationIds.has(ancestorId)) {
        hidden++
        top = ancestorId
      }
    }
    return { parentId: null, hidden, unplaced: placementAt(top).kind === 'unplaced' }
  }

  const { tree, unplaced, atRoot } = nest(listed, (id) => {
    const anchor = chainAnchor(id)
    return anchor.unplaced ? UNPLACED_ROOT : anchor.parentId
  })
  const rows = tree.map(({ entity, depth }) => mapRow(entity, depth))
  const unplacedRows = unplaced.map(({ entity, depth }) => mapRow(entity, depth))

  const anchorOf = (id: string): MapAnchor =>
    atRoot.has(id) ? { parentId: null, hidden: 0, unplaced: false } : chainAnchor(id)
  const hiddenBetween = (id: string, parentId: string | null): number | null => {
    const anchor = anchorOf(id)
    if (anchor.parentId === parentId) return anchor.unplaced ? null : anchor.hidden
    let hidden = 0
    for (const ancestorId of parentChainIds(id, parentOf)) {
      if (ancestorId === parentId) return hidden
      if (listedIds.has(ancestorId)) return null
      if (locationIds.has(ancestorId)) hidden++
    }
    return null
  }
  return { rows, unplacedRows, locations, anchorOf, hiddenBetween }
}

export function buildLocationMap(
  entities: readonly Entity[],
  currentLocationId: string | null,
): LocationMapRow[] {
  return locationMapView(entities, currentLocationId).rows
}

/** `# Current location`'s chain: the listed ancestors' names, nearest first. */
export function listedAncestorNames(locationId: string, entities: readonly Entity[]): string[] {
  const modes = placeModes(entities, locationId)
  return locationAncestors(locationId, entities)
    .filter((e) => !modes.isDisabled(e.id))
    .map((e) => e.name)
}
