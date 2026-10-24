/**
 * An item's `location` is `'inventory'` or a location id. The classifier speaks names, so its
 * text is converted here on the way in, and every stored value — legacy text included — is
 * read back here on the way out.
 */

import type { Item, Location } from '#lib/types/index.ts'
import { foldName, sameEntityName } from '#lib/utils/text.ts'

export const INVENTORY = 'inventory'

export type ItemPlacement =
  | { kind: 'inventory'; equipped: boolean }
  | { kind: 'location'; location: Location }
  | { kind: 'unresolved'; text: string }

type StoredPlacement = Pick<Item, 'location' | 'equipped'>

const WORN = new Set(['worn', 'wearing', 'equipped', 'wielded', 'wielding'])
const HERE = new Set(['ground', 'floor', 'here', 'dropped', 'nearby'])
const HELD = new Set([
  'inventory',
  'carried',
  'carrying',
  'held',
  'holding',
  'backpack',
  'bag',
  'pocket',
  'pockets',
])

type Word = 'worn' | 'here' | 'held'

function wordOf(words: string[]): Word | null {
  if (words.some((w) => WORN.has(w))) return 'worn'
  if (words.some((w) => HERE.has(w))) return 'here'
  if (words.some((w) => HELD.has(w))) return 'held'
  return null
}

/** The id an item stores: the root a branch override stands in for, which every branch shares. */
function storedId(location: Location): string {
  return location.overridesId ?? location.id
}

function withoutArticle(folded: string): string {
  return folded.replace(/^(the|a|an) /, '')
}

/** By id (or the root it overrides), by name, then by name without a leading article. */
function findLocation(value: string, locations: readonly Location[]): Location | undefined {
  const bare = withoutArticle(foldName(value))
  return (
    locations.find((l) => l.id === value || l.overridesId === value) ??
    locations.find((l) => sameEntityName(l.name, value)) ??
    (bare ? locations.find((l) => withoutArticle(foldName(l.name)) === bare) : undefined)
  )
}

/**
 * What a stored value means. Legacy text reads leniently: a location's name as that location,
 * a lone "worn" or "inventory" as the inventory. Anything else ("ground", "worn by Borin") stays
 * text: where it was meant cannot be told after the fact.
 */
export function readItemPlacement(
  item: StoredPlacement,
  locations: readonly Location[],
): ItemPlacement {
  const value = (item.location ?? '').trim()
  if (value === INVENTORY) return { kind: 'inventory', equipped: item.equipped }
  const location = value ? findLocation(value, locations) : undefined
  if (location) return { kind: 'location', location }
  const words = foldName(value).split(' ')
  const word = words.length === 1 ? wordOf(words) : null
  if (word === 'worn') return { kind: 'inventory', equipped: true }
  if (word === 'held') return { kind: 'inventory', equipped: item.equipped }
  return { kind: 'unresolved', text: value }
}

export function isInInventory(item: StoredPlacement, locations: readonly Location[]): boolean {
  return readItemPlacement(item, locations).kind === 'inventory'
}

export function isEquipped(item: StoredPlacement, locations: readonly Location[]): boolean {
  const placement = readItemPlacement(item, locations)
  return placement.kind === 'inventory' && placement.equipped
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
  /** Characters other than the protagonist: "worn by Borin" is not the protagonist's. */
  otherCharacterNames?: readonly string[]
}

/** Whether the text names one of `names`, by full name or first name, possessive included. */
function namesSomeone(words: string[], names: readonly string[]): boolean {
  const text = ` ${words.join(' ')} `
  return names.some((name) => {
    const full = foldName(name)
    if (!full) return false
    const first = withoutArticle(full).split(' ')[0]
    return [full, ...(first.length >= 3 ? [first] : [])].some(
      (n) => text.includes(` ${n} `) || text.includes(` ${n}s `),
    )
  })
}

/**
 * The stored fields for what the classifier said: both for a new item, only the changed ones
 * for an update (`existing`). Rules: docs/architecture/overview.md, World state.
 */
export function resolveItemLocation(
  said: { location?: string | null; equipped?: boolean | null },
  world: ItemLocationWorld,
  existing?: StoredPlacement,
): Partial<StoredPlacement> {
  const wasHeld = existing ? isInInventory(existing, world.locations) : true
  const equippedSaid = said.equipped ?? undefined
  const text = said.location?.trim() ?? ''

  let target: string | null
  let worn = false
  if (!text) {
    target = equippedSaid && !wasHeld ? INVENTORY : null
  } else if (text === INVENTORY) {
    target = INVENTORY
  } else {
    const location = findLocation(text, world.locations)
    const words = foldName(text).split(' ')
    const word = location ? null : wordOf(words)
    const someoneElses = namesSomeone(words, world.otherCharacterNames ?? [])
    if (location) target = storedId(location)
    else if ((word === 'worn' || word === 'held') && !someoneElses) {
      target = INVENTORY
      worn = word === 'worn'
    } else
      target = world.currentLocationId && itemLocationId(world.currentLocationId, world.locations)
  }

  // Only a held item can be equipped; an explicit `equipped` wins over "worn".
  const equipped = equippedSaid ?? (worn ? true : undefined)

  if (!existing) {
    const location = target ?? INVENTORY
    return { location, equipped: location === INVENTORY && equipped === true }
  }

  if (target === null) {
    if (equipped === undefined) return {}
    return { equipped: equipped && wasHeld }
  }
  if (target !== INVENTORY) return { location: target, equipped: false }
  if (equipped !== undefined) return { location: INVENTORY, equipped }
  return wasHeld ? { location: INVENTORY } : { location: INVENTORY, equipped: false }
}

/** The stored fields that rewrite a legacy value as what it reads as; `{}` if there is none. */
export function normalizeItemLocation(
  item: StoredPlacement,
  locations: readonly Location[],
): Partial<StoredPlacement> {
  const placement = readItemPlacement(item, locations)
  switch (placement.kind) {
    case 'inventory':
      return item.location === INVENTORY
        ? {}
        : { location: INVENTORY, equipped: placement.equipped }
    case 'location': {
      const { id, overridesId } = placement.location
      return item.location === id || item.location === overridesId
        ? {}
        : { location: storedId(placement.location) }
    }
    case 'unresolved':
      return {}
  }
}

/** The id to store for an item placed at the location `id` names. */
export function itemLocationId(id: string, locations: readonly Location[]): string {
  const location = locations.find((l) => l.id === id || l.overridesId === id)
  return location ? storedId(location) : id
}

/** Items placed at any of `locationIds`, by id or by a legacy name. */
export function itemsAt<T extends Item>(
  items: readonly T[],
  locations: readonly Location[],
  locationIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => {
    if (locationIds.has(item.location)) return true
    const placement = readItemPlacement(item, locations)
    return (
      placement.kind === 'location' &&
      (locationIds.has(placement.location.id) || locationIds.has(storedId(placement.location)))
    )
  })
}
