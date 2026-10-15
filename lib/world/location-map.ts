import type { Entity } from '@/lib/db'
import { blankToNull } from '@/lib/text'

import { stateOf } from './entity-draft'
import { byName, itemsAt, locationAncestors } from './overview'
import { parentChainIds, parentOfLocations } from './parent-chain'
import { placeModes } from './place-modes'

/** A retired place carries no id: the model can neither move the scene there nor nest under it. */
export type LocationMapRow =
  | { retired: false; id: string; name: string; depth: number; retiredReason: null }
  | { retired: true; id: null; name: string; depth: number; retiredReason: string | null }
export type HeldItemLine = { id: string; name: string; equipped: boolean }
export type LooseItemLine = { id: string; name: string }

/** Where the map hangs a place, listed or not, and how many left-out places lie in between. */
export type MapAnchor = { parentId: string | null; hidden: number }

export type LocationMapView = {
  rows: LocationMapRow[]
  anchorOf: (id: string) => MapAnchor
  /**
   * Left-out places between a place and `parentId` (null: root), or null if the map wouldn't hang
   * it there. A left-out `parentId` counts as listed: only a reused handle can reach one.
   */
  hiddenBetween: (id: string, parentId: string | null) => number | null
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

  const childrenOf = new Map<string | null, Entity[]>()
  for (const location of listed) {
    const { parentId } = chainAnchor(location.id)
    const siblings = childrenOf.get(parentId)
    if (siblings === undefined) childrenOf.set(parentId, [location])
    else siblings.push(location)
  }

  const rows: LocationMapRow[] = []
  const reached = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    for (const location of (childrenOf.get(parentId) ?? []).sort(byName)) {
      reached.add(location.id)
      rows.push(mapRow(location, depth))
      walk(location.id, depth + 1)
    }
  }
  walk(null, 0)
  // A chain looping through listed rows never reaches the root: list those rows there, flat.
  const unreached = listed.filter((e) => !reached.has(e.id)).sort(byName)
  for (const location of unreached) rows.push(mapRow(location, 0))
  const atRoot = new Set(unreached.map((e) => e.id))

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
  return { rows, anchorOf, hiddenBetween }
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
