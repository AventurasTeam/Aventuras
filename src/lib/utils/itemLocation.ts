// An item's `location` is `'inventory'` or a location id; `equipped` is true only in the
// inventory. Rules: docs/architecture/overview.md, World state.

import type { Character, Item, Location } from '#lib/types/index.ts'
import { normalizeName } from '#lib/services/duplicates/index.ts'
import { foldName, sameEntityName } from '#lib/utils/text.ts'

export const INVENTORY = 'inventory'

/** What an item's `location` accepts from the classifier. */
export const ITEM_LOCATION_OPTIONS =
  'inventory, worn, ground (where the passage ends), or a location name spelled exactly as listed under Locations'

type ItemPlacement =
  | { kind: 'inventory'; equipped: boolean }
  | { kind: 'location'; location: Location }
  | { kind: 'unresolved'; text: string }

type StoredPlacement = Pick<Item, 'location' | 'equipped'>

const words = (list: string) => new Set(list.split(' '))

/** Worn by whoever holds it. Body parts count only where nothing else could be meant. */
const WORN = words(
  'worn wearing wears equipped wielded wielding wields donned neck finger wrist head',
)
const UNWORN = words('unequipped unworn')
const HERE = words('ground floor here dropped nearby')
/** Taken into the inventory: "picked up from the floor" is held, not lying there. */
const TAKEN = words('picked up taken given handed received grabbed retrieved')
const HELD = words(
  'inventory carried carrying carries held holding holds hand hands person possession backpack pack knapsack rucksack bag satchel pouch purse sack pocket pockets belt hip sheath sheathed scabbard quiver holster holstered',
)
/** Held words that cannot be part of a place's name, so they count among other words too. */
const CARRY = words(
  'inventory hand hands backpack pack knapsack rucksack bag satchel saddlebag pouch purse pocket pockets belt sheath scabbard quiver holster coat cloak jacket sleeve boot boots neck finger wrist',
)
/** Words that say whose it is, or how it is held, and nothing about where. */
const FILLER = words(
  'in on at by from into onto inside within around under over with of to the a an and it his her hers their its my your our own left right both back shoulder shoulders strapped slung tucked stowed kept main off currently still safely securely now is are was were being been',
)
const POSSESSIVE = words('his her hers their my your our own')
const ARTICLES = words('the a an')
/** Beside a container, or passed on: "next to her pack", "in her hand, then given to the guard". */
const AWAY = words('beside next near then towards')
/** Shared by several characters, so they name none of them. */
const TITLES = words(
  'sir lady lord dame captain king queen prince princess father mother brother sister doctor dr master mistress',
)
/** The protagonist, however a passage addresses them. */
const SELF = words('you me yourself myself protagonist player')
const PREPOSITIONS = words('in on at inside within into onto near by outside to from back')

export interface ItemLocationPeople {
  /** "in Aria's pack" is the inventory. */
  protagonistName?: string | null
  /** "worn by Borin" is not. */
  otherCharacterNames?: readonly string[]
}

export function castNames(characters: readonly Character[]): ItemLocationPeople {
  return {
    protagonistName: characters.find((c) => c.relationship === 'self')?.name ?? null,
    otherCharacterNames: characters.filter((c) => c.relationship !== 'self').map((c) => c.name),
  }
}

/** A held item's `worn`: true or false when the text says so, undefined when it does not. */
type Stated = { kind: 'held'; worn?: boolean } | { kind: 'here' }

const tokens = (name: string) => foldName(name).split(' ').filter(Boolean)
const has = (set: Set<string>, w: string) =>
  set.has(w) || (w.endsWith('s') && set.has(w.slice(0, -1)))

/** The placement `text` states, or null when it names somewhere or someone else. */
function statedPlacement(text: string, people: ItemLocationPeople): Stated | null {
  // A title names someone only when it is all of their name: "The Captain", not "Sir Gareth".
  const named = (name: string) => {
    const parts = tokens(name).filter((w) => !FILLER.has(w))
    const proper = parts.filter((w) => !TITLES.has(w))
    return proper.length > 0 ? proper : parts
  }
  const own = new Set([...named(people.protagonistName ?? ''), ...SELF])
  const others = new Set(
    (people.otherCharacterNames ?? []).flatMap(named).filter((w) => !own.has(w)),
  )
  const isOwn = (w: string) => has(own, w)

  const written = text.split(/[^\p{L}\p{N}'’]+/u)
  const capitalised = written.filter((w) => /^\p{Lu}/u.test(w)).flatMap(tokens)
  if (capitalised.some((w) => has(others, w))) return null

  const all = tokens(text.replace(/\bno longer\b/giu, 'not'))
  // "not carried" means it left; "not worn" only unequips.
  if (all.some((w, i) => w === 'not' && !WORN.has(all[i + 1] ?? ''))) return null
  const taken = all.some((w) => TAKEN.has(w))
  // "given to her" or "handed over": passed to someone, unless that is the protagonist.
  const recipient = (i: number) => all.slice(i + 1).find((w) => !ARTICLES.has(w)) ?? ''
  const passedOn = all.some(
    (w, i) =>
      (w === 'to' && all.slice(0, i).some((t) => TAKEN.has(t)) && !isOwn(recipient(i))) ||
      (w === 'over' && TAKEN.has(all[i - 1] ?? '')),
  )
  if (passedOn) return null
  if (!taken && all.some((w) => HERE.has(w))) return { kind: 'here' }

  const unworn = all.some((w) => w === 'not' || UNWORN.has(w))
  const worn = unworn ? false : all.some((w) => WORN.has(w)) || undefined
  const owned = all.some((w) => POSSESSIVE.has(w) || isOwn(w))
  const saysNothing = (w: string) =>
    [FILLER, UNWORN, TAKEN, HERE].some((set) => set.has(w)) ||
    (TITLES.has(w) && !has(others, w)) ||
    w === 'not' ||
    isOwn(w)
  const rest = all.filter((w) => !saysNothing(w))
  if (rest.length === 0) return owned || taken || unworn ? { kind: 'held', worn } : null
  if (rest.every((w) => WORN.has(w) || HELD.has(w) || CARRY.has(w))) {
    return { kind: 'held', worn }
  }

  const someoneElses = written.some((w) => /['’]s$/iu.test(w) && !isOwn(foldName(w.slice(0, -2))))
  const ownerBefore = (i: number) =>
    all.slice(Math.max(0, i - 3), i).some((w) => POSSESSIVE.has(w) || isOwn(w))
  const ownCarry = all.some((w, i) => CARRY.has(w) && ownerBefore(i))
  if (ownCarry && !someoneElses && !all.some((w) => AWAY.has(w))) return { kind: 'held', worn }
  return null
}

/** The id an item stores: the root a branch override stands in for, which every branch shares. */
function storedId(location: Location): string {
  return location.overridesId ?? location.id
}

function byId(id: string, locations: readonly Location[]): Location | undefined {
  return locations.find((l) => l.id === id || l.overridesId === id)
}

function byName(value: string, locations: readonly Location[]): Location | undefined {
  const bare = normalizeName(value)
  return (
    locations.find((l) => sameEntityName(l.name, value)) ??
    (bare ? locations.find((l) => normalizeName(l.name) === bare) : undefined)
  )
}

/**
 * By id (or the root it overrides), by name, then by name without its leading article. Last,
 * without a leading preposition or a parenthesis: "in the Holding Cells (back room)".
 */
function findLocation(value: string, locations: readonly Location[]): Location | undefined {
  const found = byId(value, locations) ?? byName(value, locations)
  if (found) return found
  const all = foldName(value.replace(/\([^)]*\)/gu, ' '))
    .split(' ')
    .filter(Boolean)
  const start = all.findIndex((w) => !PREPOSITIONS.has(w))
  const bare = start < 0 ? '' : all.slice(start).join(' ')
  return bare && bare !== foldName(value) ? byName(bare, locations) : undefined
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

export interface ItemLocationWorld extends ItemLocationPeople {
  locations: readonly Location[]
  /** The scene's location after this turn's scene change. */
  currentLocationId: string | null
}

type Target =
  { kind: 'inventory'; worn?: boolean } | { kind: 'location'; id: string } | { kind: 'none' }

function targetOf(text: string, world: ItemLocationWorld): Target {
  if (text === INVENTORY) return { kind: 'inventory' }
  const location = findLocation(text, world.locations)
  if (location) return { kind: 'location', id: storedId(location) }
  const stated = statedPlacement(text, world)
  if (stated?.kind === 'held') return { kind: 'inventory', worn: stated.worn }
  // "ground", a part of the scene's place, or something someone else holds.
  if (!world.currentLocationId) return { kind: 'none' }
  return { kind: 'location', id: itemLocationId(world.currentLocationId, world.locations) }
}

type Said = { location?: string | null; equipped?: boolean | null }

export function newItemLocation(said: Said, world: ItemLocationWorld): StoredPlacement {
  const text = said.location?.trim() ?? ''
  const target: Target = text ? targetOf(text, world) : { kind: 'none' }
  if (target.kind === 'location') return { location: target.id, equipped: false }
  // Text that names no placement of the protagonist's ("worn by Sir Gareth") is never equipped.
  if (target.kind === 'none' && text) return { location: INVENTORY, equipped: false }
  const worn = target.kind === 'inventory' ? target.worn : undefined
  return { location: INVENTORY, equipped: said.equipped ?? worn ?? false }
}

/**
 * The stored fields for an update to `existing`; `{}` if its placement does not change. Both
 * fields are written together, so a legacy row is rewritten with the first change to either.
 */
export function resolveItemLocation(
  said: Said,
  world: ItemLocationWorld,
  existing: StoredPlacement,
): Partial<StoredPlacement> {
  const wasHeld = existing.location === INVENTORY
  const equippedSaid = said.equipped ?? undefined
  const text = said.location?.trim() ?? ''

  let target: Target
  if (text) target = targetOf(text, world)
  else if (equippedSaid && !wasHeld) target = { kind: 'inventory' }
  else target = { kind: 'none' }

  // An explicit `equipped` wins over "worn".
  const equipped = equippedSaid ?? (target.kind === 'inventory' ? target.worn : undefined)

  switch (target.kind) {
    case 'none':
      if (equipped === undefined) return {}
      return { location: existing.location, equipped: equipped && wasHeld && !text }
    case 'location':
      return { location: target.id, equipped: false }
    case 'inventory':
      return { location: INVENTORY, equipped: equipped ?? (wasHeld && existing.equipped) }
  }
}

/**
 * The stored fields that rewrite a legacy value; `{}` if there is none. A location's name
 * becomes its id, and "worn" or "carried" the inventory. Text that names no placement
 * ("ground", "worn by Borin") stays: where it was meant cannot be told after the fact.
 */
export function normalizeItemLocation(
  item: StoredPlacement,
  locations: readonly Location[],
  people: ItemLocationPeople = {},
): Partial<StoredPlacement> {
  if (item.location === INVENTORY) return {}
  const value = (item.location ?? '').trim()
  const location = value ? findLocation(value, locations) : undefined
  const stated = value && !location ? statedPlacement(value, people) : null

  let changes: Partial<StoredPlacement> = {}
  if (location) changes = { location: storedId(location) }
  else if (stated?.kind === 'held') {
    changes = { location: INVENTORY }
    if (stated.worn !== undefined) changes.equipped = stated.worn
  }

  if (changes.location === item.location) delete changes.location
  if (changes.location !== INVENTORY && item.equipped) changes.equipped = false
  return changes
}

/** `items` with every legacy value rewritten; an item that needs nothing is passed through. */
export function normalizeItems<T extends Item>(
  items: readonly T[],
  locations: readonly Location[],
  characters: readonly Character[],
): T[] {
  const people = castNames(characters)
  return items.map((item) => {
    const changes = normalizeItemLocation(item, locations, people)
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
