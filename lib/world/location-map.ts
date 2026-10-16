import type { Entity } from '@/lib/db'
import { blankToNull } from '@/lib/text'

import { stateOf } from './entity-draft'
import { byName, itemsAt, locationAncestors } from './overview'
import { parentChainIds, parentIdOf, parentOfLocations } from './parent-chain'
import { placeModes } from './place-modes'

/** A retired row carries no id: the map offers none to move the scene to or nest a place under. */
export type LocationMapRow =
  | { retired: false; id: string; name: string; depth: number; retiredReason: null }
  | { retired: true; id: null; name: string; depth: number; retiredReason: string | null }
export type HeldItemLine = { id: string; name: string; equipped: boolean }
export type LooseItemLine = { id: string; name: string }

/** A place and how deep it sits in the tree. */
export type PlaceTreeRow = { entity: Entity; depth: number }

/** Where the map hangs a place, listed or not, and how many left-out places lie in between. */
export type MapAnchor = { parentId: string | null; hidden: number }

export type LocationMapView = {
  rows: LocationMapRow[]
  /** Every location the view was built from, of any status, listed or not. */
  locations: readonly Entity[]
  anchorOf: (id: string) => MapAnchor
  /**
   * Left-out places between a place and `parentId` (null: root), or null if the map wouldn't hang
   * it there. A left-out `parentId` counts as listed, since `# In scene`, the fallback's roster
   * or a reused handle can name one.
   */
  hiddenBetween: (id: string, parentId: string | null) => number | null
}

/** The place-matching half of a view: which places exist, and where a place hangs. */
export type LocationMatchView = Pick<LocationMapView, 'locations' | 'hiddenBetween'>

// A chain looping through the given places never reaches the root: those places are listed there,
// flat, and returned in `atRoot`.
function nest(
  places: readonly Entity[],
  parentOf: (id: string) => string | null,
): { tree: PlaceTreeRow[]; atRoot: ReadonlySet<string> } {
  const childrenOf = new Map<string | null, Entity[]>()
  for (const place of places) {
    const parentId = parentOf(place.id)
    const siblings = childrenOf.get(parentId)
    if (siblings === undefined) childrenOf.set(parentId, [place])
    else siblings.push(place)
  }

  const tree: PlaceTreeRow[] = []
  const reached = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    for (const place of (childrenOf.get(parentId) ?? []).sort(byName)) {
      reached.add(place.id)
      tree.push({ entity: place, depth })
      walk(place.id, depth + 1)
    }
  }
  walk(null, 0)
  const unreached = places.filter((e) => !reached.has(e.id)).sort(byName)
  for (const place of unreached) tree.push({ entity: place, depth: 0 })
  return { tree, atRoot: new Set(unreached.map((e) => e.id)) }
}

function realParentOf(locations: readonly Entity[]): (id: string) => string | null {
  const byId = new Map(locations.map((e) => [e.id, e]))
  return (id) => {
    const row = byId.get(id)
    const parentId = row === undefined ? null : parentIdOf(row)
    return parentId !== null && byId.has(parentId) ? parentId : null
  }
}

/**
 * classifier.md → Mentioned places: every place on the branch, whatever its status or mode, under
 * its real parent. A parent that is no place puts it at the root.
 */
export function placeTree(entities: readonly Entity[]): PlaceTreeRow[] {
  const locations = entities.filter((e) => e.kind === 'location')
  return nest(locations, realParentOf(locations)).tree
}

/** A view that hides nothing: a place hangs only under its real parent (null: the root). */
export function unhiddenLocationView(entities: readonly Entity[]): LocationMatchView {
  const locations = entities.filter((e) => e.kind === 'location')
  const parentOf = realParentOf(locations)
  const ids = new Set(locations.map((e) => e.id))
  return {
    locations,
    hiddenBetween: (id, parentId) => (ids.has(id) && parentOf(id) === parentId ? 0 : null),
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
        retiredReason: blankToNull((location.retiredReason ?? '').replace(/\s+/g, ' ')),
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
  const chainAnchor = (id: string): MapAnchor => {
    let hidden = 0
    for (const ancestorId of parentChainIds(id, parentOf)) {
      if (listedIds.has(ancestorId)) return { parentId: ancestorId, hidden }
      if (locationIds.has(ancestorId)) hidden++
    }
    return { parentId: null, hidden }
  }

  const { tree, atRoot } = nest(listed, (id) => chainAnchor(id).parentId)
  const rows = tree.map(({ entity, depth }) => mapRow(entity, depth))

  const anchorOf = (id: string): MapAnchor =>
    atRoot.has(id) ? { parentId: null, hidden: 0 } : chainAnchor(id)
  const hiddenBetween = (id: string, parentId: string | null): number | null => {
    const anchor = anchorOf(id)
    if (anchor.parentId === parentId) return anchor.hidden
    let hidden = 0
    for (const ancestorId of parentChainIds(id, parentOf)) {
      if (ancestorId === parentId) return hidden
      if (listedIds.has(ancestorId)) return null
      if (locationIds.has(ancestorId)) hidden++
    }
    return null
  }
  return { rows, locations, anchorOf, hiddenBetween }
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

/** `Holds:`: inventory, then equipped items. An id in both arrays shows once, as equipped. */
export function heldItemLines(character: Entity, entities: readonly Entity[]): HeldItemLine[] {
  const state = stateOf(character, 'character')
  const inventory = state.inventory ?? []
  const equippedItems = state.equipped_items ?? []
  const equipped = new Set(equippedItems)
  const items = new Map(
    entities.filter((e) => e.kind === 'item' && e.status !== 'retired').map((e) => [e.id, e]),
  )
  const shown = new Set<string>()
  const lines: HeldItemLine[] = []
  const add = (id: string, isEquipped: boolean): void => {
    const row = items.get(id)
    if (row === undefined || shown.has(id)) return
    shown.add(id)
    lines.push({ id, name: row.name, equipped: isEquipped })
  }
  for (const id of inventory) if (!equipped.has(id)) add(id, false)
  for (const id of equippedItems) add(id, true)
  return lines
}

/** `Here:`: the unretired items lying at the location, by name. */
export function looseItemLines(locationId: string, entities: readonly Entity[]): LooseItemLine[] {
  return itemsAt(locationId, entities)
    .filter((e) => e.status !== 'retired')
    .map((e) => ({ id: e.id, name: e.name }))
}
