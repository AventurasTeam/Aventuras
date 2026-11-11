// An item's `location` is `'inventory'` or a location id; `equipped` is true only in the
// inventory. Rules: docs/architecture/overview.md, World state.

import type { Item, Location } from '#lib/types/index.ts'
import { normalizeName } from '#lib/services/duplicates/index.ts'
import { foldName, sameEntityName } from '#lib/utils/text.ts'

export const INVENTORY = 'inventory'

/** What an item's `location` accepts from the classifier. Other text is ignored. */
export const ITEM_LOCATION_OPTIONS =
  'inventory, worn, ground (where the passage ends), or a location name spelled exactly as listed under Locations'

const WORN = new Set(['worn', 'equipped'])
const GROUND = 'ground'

type ItemPlacement =
  | { kind: 'inventory'; equipped: boolean }
  | { kind: 'location'; location: Location }
  | { kind: 'unresolved'; text: string }

type StoredPlacement = Pick<Item, 'location' | 'equipped'>

/** The id an item stores: the root a branch override stands in for, which every branch shares. */
function storedId(location: Location): string {
  return location.overridesId ?? location.id
}

function byId(id: string, locations: readonly Location[]): Location | undefined {
  return locations.find((l) => l.id === id || l.overridesId === id)
}

/** By id (or the root it overrides), by name, then by name without its leading article. */
function findLocation(value: string, locations: readonly Location[]): Location | undefined {
  const bare = normalizeName(value)
  return (
    byId(value, locations) ??
    locations.find((l) => sameEntityName(l.name, value)) ??
    (bare ? locations.find((l) => normalizeName(l.name) === bare) : undefined)
  )
}

export function readItemPlacement(
  item: StoredPlacement,
  locations: readonly Location[],
): ItemPlacement {
  if (item.location === INVENTORY) return { kind: 'inventory', equipped: item.equipped }
  const location = byId(item.location, locations)
  if (location) return { kind: 'location', location }
  return { kind: 'unresolved', text: item.location }
}

const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The placement as text: "Inventory", the location's name, or the stored text. An id that
 * matches no location (its location was deleted) reads as "Unknown location".
 */
export function itemLocationLabel(
  placement: ItemPlacement,
  opts: { translated?: boolean } = {},
): string {
  switch (placement.kind) {
    case 'inventory':
      return 'Inventory'
    case 'location':
      return (opts.translated ? placement.location.translatedName : null) ?? placement.location.name
    case 'unresolved':
      return !placement.text || ID_SHAPE.test(placement.text) ? 'Unknown location' : placement.text
  }
}

export interface ItemLocationWorld {
  locations: readonly Location[]
  /** The scene's location after this turn's scene change. */
  currentLocationId: string | null
}

type Target =
  { kind: 'inventory'; worn?: boolean } | { kind: 'location'; id: string } | { kind: 'none' }

function targetOf(text: string, world: ItemLocationWorld): Target {
  const word = foldName(text)
  if (word === INVENTORY) return { kind: 'inventory' }
  if (WORN.has(word)) return { kind: 'inventory', worn: true }
  if (word === GROUND) {
    if (!world.currentLocationId) return { kind: 'none' }
    return { kind: 'location', id: itemLocationId(world.currentLocationId, world.locations) }
  }
  const location = findLocation(text, world.locations)
  return location ? { kind: 'location', id: storedId(location) } : { kind: 'none' }
}

type Said = { location?: string | null; equipped?: boolean | null }

/** A new item's stored fields. Text that is not one of the options leaves it in the inventory. */
export function newItemLocation(said: Said, world: ItemLocationWorld): StoredPlacement {
  const text = said.location?.trim() ?? ''
  const target: Target = text ? targetOf(text, world) : { kind: 'none' }
  if (target.kind === 'location') return { location: target.id, equipped: false }
  const worn = target.kind === 'inventory' ? target.worn : undefined
  return { location: INVENTORY, equipped: said.equipped ?? worn ?? false }
}

/**
 * The stored fields for an update to `existing`; `{}` if its placement does not change. Text
 * that is not one of the options is ignored. Both fields are written together, so a legacy row
 * is rewritten with the first change to either.
 */
export function resolveItemLocation(
  said: Said,
  world: ItemLocationWorld,
  existing: StoredPlacement,
): Partial<StoredPlacement> {
  const wasHeld = existing.location === INVENTORY
  const equippedSaid = said.equipped ?? undefined
  const text = said.location?.trim() ?? ''

  // A legacy "ground" row is shown to the classifier as is; repeating it is not a move.
  const groundEcho = foldName(text) === GROUND && foldName(existing.location) === GROUND
  let target: Target = text && !groundEcho ? targetOf(text, world) : { kind: 'none' }
  // Equipping an item takes it.
  if (target.kind === 'none' && equippedSaid && !wasHeld) target = { kind: 'inventory' }

  // An explicit `equipped` wins over "worn".
  const equipped = equippedSaid ?? (target.kind === 'inventory' ? target.worn : undefined)

  switch (target.kind) {
    case 'none':
      if (equipped === undefined) return {}
      return { location: existing.location, equipped: equipped && wasHeld }
    case 'location':
      return { location: target.id, equipped: false }
    case 'inventory':
      return { location: INVENTORY, equipped: equipped ?? (wasHeld && existing.equipped) }
  }
}

/**
 * The stored fields that rewrite a legacy value; `{}` if there is none. Empty text and
 * `inventory` are the inventory, `worn` the inventory equipped, and a location's name its id.
 * Other text ("ground", "in her pack") stays: where it was meant cannot be told after the fact.
 */
export function normalizeItemLocation(
  item: StoredPlacement,
  locations: readonly Location[],
): Partial<StoredPlacement> {
  if (item.location === INVENTORY) return {}
  const value = (item.location ?? '').trim()
  const word = foldName(value)

  let changes: Partial<StoredPlacement> = {}
  if (!word || word === INVENTORY) changes = { location: INVENTORY }
  else if (WORN.has(word)) changes = { location: INVENTORY, equipped: true }
  else {
    const location = findLocation(value, locations)
    if (location && storedId(location) !== item.location) changes = { location: storedId(location) }
  }

  if (changes.location !== INVENTORY && item.equipped) changes.equipped = false
  return changes
}

/** `items` with every legacy value rewritten; an item that needs nothing is passed through. */
export function normalizeItems<T extends Item>(
  items: readonly T[],
  locations: readonly Location[],
): T[] {
  return items.map((item) => {
    const changes = normalizeItemLocation(item, locations)
    return Object.keys(changes).length > 0 ? { ...item, ...changes } : item
  })
}

/** The id to store for an item placed at the location `id` names. */
export function itemLocationId(id: string, locations: readonly Location[]): string {
  const location = byId(id, locations)
  return location ? storedId(location) : id
}

/**
 * A new id for each copied location, by old id. An override's root id maps to the override's
 * copy too, since that is the id its items hold.
 */
export function copiedLocationIds(locations: readonly Location[]): Map<string, string> {
  const ids = new Map<string, string>()
  for (const loc of locations) ids.set(loc.id, crypto.randomUUID())
  for (const loc of locations) {
    if (loc.overridesId && !ids.has(loc.overridesId)) ids.set(loc.overridesId, ids.get(loc.id)!)
  }
  return ids
}

/**
 * The items deleting `locationId` moves to the scene's location, or `null` when it holds items
 * and there is no other scene location to take them.
 */
export function itemsToMoveOnDelete<T extends Item>(
  items: readonly T[],
  locations: readonly Location[],
  locationId: string,
  sceneId: string | undefined,
): T[] | null {
  const strays = itemsAt(items, locations, new Set([locationId]))
  if (strays.length === 0) return []
  return sceneId && sceneId !== locationId ? strays : null
}

/** Items placed at any of `locationIds`, or at the root one of them overrides. */
export function itemsAt<T extends Item>(
  items: readonly T[],
  locations: readonly Location[],
  locationIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => {
    if (locationIds.has(item.location)) return true
    const location = byId(item.location, locations)
    return !!location && (locationIds.has(location.id) || locationIds.has(storedId(location)))
  })
}
