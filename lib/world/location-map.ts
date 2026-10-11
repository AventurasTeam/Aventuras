import type { Entity } from '@/lib/db'

import { stateOf } from './entity-draft'
import { byName } from './overview'
import { parentChainIds, parentOfLocations } from './parent-chain'

export type LocationMapRow = { id: string; name: string; depth: number }
export type HeldItemLine = { id: string; name: string; equipped: boolean }
export type LooseItemLine = { id: string; name: string }

// The structural floor seats the current location whatever its injection mode, so the map
// lists it too (piggyback.md → What the writer sees).
function isListed(entity: Entity, currentLocationId: string | null): boolean {
  if (entity.kind !== 'location' || entity.status === 'retired') return false
  return entity.injectionMode !== 'disabled' || entity.id === currentLocationId
}

/**
 * The `# Places` tree in pre-order, siblings by name. A left-out location's children hang under
 * its nearest listed ancestor.
 */
export function buildLocationMap(
  entities: readonly Entity[],
  currentLocationId: string | null,
): LocationMapRow[] {
  const listed = entities.filter((e) => isListed(e, currentLocationId))
  const listedIds = new Set(listed.map((e) => e.id))
  const parentOf = parentOfLocations(entities)
  const childrenOf = new Map<string | null, Entity[]>()
  for (const location of listed) {
    const anchor = parentChainIds(location.id, parentOf).find((id) => listedIds.has(id)) ?? null
    const siblings = childrenOf.get(anchor)
    if (siblings === undefined) childrenOf.set(anchor, [location])
    else siblings.push(location)
  }

  const rows: LocationMapRow[] = []
  const reached = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    for (const location of (childrenOf.get(parentId) ?? []).sort(byName)) {
      reached.add(location.id)
      rows.push({ id: location.id, name: location.name, depth })
      walk(location.id, depth + 1)
    }
  }
  walk(null, 0)
  // A chain looping through listed rows never reaches the root: list those rows there, flat.
  for (const location of listed.filter((e) => !reached.has(e.id)).sort(byName))
    rows.push({ id: location.id, name: location.name, depth: 0 })
  return rows
}

/** `# Current location`'s chain: the listed ancestors' names, nearest first. */
export function listedAncestorNames(
  locationId: string,
  entities: readonly Entity[],
  currentLocationId: string | null,
): string[] {
  const listedNames = new Map(
    entities.filter((e) => isListed(e, currentLocationId)).map((e) => [e.id, e.name]),
  )
  return parentChainIds(locationId, parentOfLocations(entities)).flatMap((id) => {
    const name = listedNames.get(id)
    return name === undefined ? [] : [name]
  })
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
  return entities
    .filter(
      (e) =>
        e.kind === 'item' &&
        e.status !== 'retired' &&
        stateOf(e, 'item').at_location_id === locationId,
    )
    .sort(byName)
    .map((e) => ({ id: e.id, name: e.name }))
}
