import { describe, it, expect } from 'vitest'
import type { Item, Location } from '#lib/types/index.ts'
import {
  copiedLocationIds,
  itemLocationLabel,
  itemsAt,
  itemsToMoveOnDelete,
  newItemLocation,
  normalizeItemLocation,
  normalizeItems,
  readItemPlacement,
  resolveItemLocation,
  type ItemLocationWorld,
} from './itemLocation'

function location(name: string, overrides: Partial<Location> = {}): Location {
  return {
    id: `loc-${name}`,
    storyId: 's1',
    name,
    description: null,
    visited: true,
    current: false,
    connections: [],
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

function item(name: string, overrides: Partial<Item> = {}): Item {
  return {
    id: `item-${name}`,
    storyId: 's1',
    name,
    description: null,
    quantity: 1,
    equipped: false,
    location: 'inventory',
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

const tavern = location("Kaelen's Rest")
const cave = location('Crystal Caverns')
const world: ItemLocationWorld = { locations: [tavern, cave], currentLocationId: tavern.id }
const nowhere: ItemLocationWorld = { ...world, currentLocationId: null }

/** Text that is not one of the options. */
const OFF_LIST = [
  'in her pack',
  'worn by Borin',
  'the holding cells',
  'the Worn Bridge',
  'in the Crystal Caverns',
  'Unknown location',
  'somewhere',
]

describe('newItemLocation', () => {
  it('stores the id of a location named exactly', () => {
    expect(newItemLocation({ location: 'Crystal Caverns' }, world)).toEqual({
      location: cave.id,
      equipped: false,
    })
  })

  it('matches a name across case, accents and punctuation', () => {
    expect(newItemLocation({ location: 'kaelens rest' }, world).location).toBe(tavern.id)
    expect(newItemLocation({ location: 'CRYSTAL  CAVERNS' }, world).location).toBe(cave.id)
    const named = { ...world, locations: [location('Élan Hall')] }
    expect(newItemLocation({ location: 'Elan hall' }, named).location).toBe('loc-Élan Hall')
  })

  it('matches a name given without its article, in other languages too', () => {
    const inn = location('The Pack Mule Inn')
    const taverna = location('La Taverna')
    const listed = { ...world, locations: [inn, taverna, cave] }
    expect(newItemLocation({ location: 'Pack Mule Inn' }, listed).location).toBe(inn.id)
    expect(newItemLocation({ location: 'Taverna' }, listed).location).toBe(taverna.id)
  })

  it('stores the options as documented', () => {
    expect(newItemLocation({ location: 'inventory' }, world)).toEqual({
      location: 'inventory',
      equipped: false,
    })
    for (const said of ['worn', 'Equipped']) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: true,
      })
    }
    expect(newItemLocation({ location: 'Ground' }, world)).toEqual({
      location: tavern.id,
      equipped: false,
    })
  })

  it('puts an item with any other text in the inventory, the default', () => {
    for (const said of OFF_LIST) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: false,
      })
    }
  })

  it('reads a listed place that shares a word with an option as that place', () => {
    const bridge = location('The Worn Bridge')
    const listed = { ...world, locations: [tavern, bridge] }
    expect(newItemLocation({ location: 'the Worn Bridge' }, listed).location).toBe(bridge.id)
  })

  it('lets an explicit equipped: false win over worn', () => {
    expect(newItemLocation({ location: 'worn', equipped: false }, world)).toEqual({
      location: 'inventory',
      equipped: false,
    })
  })

  it("stores the root id of a branch's override, which every branch shares", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const onBranch = { ...world, locations: [tavern, override], currentLocationId: override.id }
    expect(newItemLocation({ location: 'Crystal Caverns' }, onBranch).location).toBe(cave.id)
    expect(newItemLocation({ location: 'ground' }, onBranch).location).toBe(cave.id)
  })

  it('passes an existing id through', () => {
    expect(newItemLocation({ location: cave.id }, world).location).toBe(cave.id)
  })

  it('defaults to the inventory, honouring equipped', () => {
    expect(newItemLocation({}, world)).toEqual({ location: 'inventory', equipped: false })
    expect(newItemLocation({ equipped: true }, world)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('cannot equip an item at a location', () => {
    expect(newItemLocation({ location: 'Crystal Caverns', equipped: true }, world)).toEqual({
      location: cave.id,
      equipped: false,
    })
  })

  it('goes to the inventory when there is no scene location to put it in', () => {
    expect(newItemLocation({ location: 'ground' }, nowhere).location).toBe('inventory')
    expect(newItemLocation({ location: 'Crystal Caverns' }, nowhere).location).toBe(cave.id)
  })

  it('resolves a location created in the same response', () => {
    // The store resolves items after the response's locations and scene change are applied.
    const newCave = location('Sunken Grotto', { current: true })
    const after = { locations: [tavern, cave, newCave], currentLocationId: newCave.id }
    expect(newItemLocation({ location: 'Sunken Grotto' }, after).location).toBe(newCave.id)
    expect(newItemLocation({ location: 'ground' }, after).location).toBe(newCave.id)
  })
})

describe('resolveItemLocation', () => {
  const held = item('Sword')
  const lying = item('Lantern', { location: cave.id })

  it('changes nothing when nothing placement-related was said', () => {
    expect(resolveItemLocation({}, world, held)).toEqual({})
  })

  it('ignores any other text', () => {
    for (const said of OFF_LIST) {
      expect(resolveItemLocation({ location: said }, world, held)).toEqual({})
      expect(resolveItemLocation({ location: said }, world, lying)).toEqual({})
    }
    const legacy = item('Chest', { location: 'Chest in Oakvale' })
    expect(resolveItemLocation({ location: 'Chest in Oakvale' }, world, legacy)).toEqual({})
  })

  it('moves an item to a location and unequips it', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'ground' }, world, equipped)).toEqual({
      location: tavern.id,
      equipped: false,
    })
    expect(resolveItemLocation({ location: 'Crystal Caverns' }, world, equipped)).toEqual({
      location: cave.id,
      equipped: false,
    })
  })

  it('does not move a legacy "ground" item when the classifier repeats it', () => {
    const dropped = item('Rope', { location: 'ground' })
    expect(resolveItemLocation({ location: 'Ground' }, world, dropped)).toEqual({})
    expect(resolveItemLocation({ location: 'inventory' }, world, dropped)).toEqual({
      location: 'inventory',
      equipped: false,
    })
  })

  it('keeps the existing location when there is no scene location', () => {
    expect(resolveItemLocation({ location: 'ground' }, nowhere, lying)).toEqual({})
    expect(resolveItemLocation({ location: 'ground' }, nowhere, held)).toEqual({})
  })

  it('picks an item up', () => {
    expect(resolveItemLocation({ location: 'inventory' }, world, lying)).toEqual({
      location: 'inventory',
      equipped: false,
    })
    expect(resolveItemLocation({ location: 'worn' }, world, lying)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('takes an item into the inventory when it is equipped', () => {
    expect(resolveItemLocation({ equipped: true }, world, lying)).toEqual({
      location: 'inventory',
      equipped: true,
    })
    expect(resolveItemLocation({ equipped: true }, world, held)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('keeps equipped as it is when a held item stays held', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'inventory' }, world, equipped)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('unequips on an explicit equipped: false', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'worn', equipped: false }, world, equipped)).toEqual({
      location: 'inventory',
      equipped: false,
    })
    expect(resolveItemLocation({ equipped: false }, world, equipped)).toEqual({
      location: 'inventory',
      equipped: false,
    })
  })

  it('writes the location with equipped, so a legacy row is rewritten', () => {
    const legacy = item('Cloak', { location: 'worn' })
    const loaded = { ...legacy, ...normalizeItemLocation(legacy, world.locations) }
    expect(resolveItemLocation({ equipped: false }, world, loaded)).toEqual({
      location: 'inventory',
      equipped: false,
    })
  })
})

describe('readItemPlacement', () => {
  const locations = [tavern, cave]

  it('reads the inventory and location ids', () => {
    expect(readItemPlacement(item('a', { equipped: true }), locations)).toEqual({
      kind: 'inventory',
      equipped: true,
    })
    expect(readItemPlacement(item('a', { location: cave.id }), locations)).toEqual({
      kind: 'location',
      location: cave,
    })
  })

  it("reads a branch's override of the location an item was left at", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    expect(readItemPlacement(item('a', { location: cave.id }), [tavern, override])).toEqual({
      kind: 'location',
      location: override,
    })
  })

  it('reads anything else as its text', () => {
    expect(readItemPlacement(item('a', { location: 'ground' }), locations)).toEqual({
      kind: 'unresolved',
      text: 'ground',
    })
  })
})

describe('itemLocationLabel', () => {
  it('names the placement', () => {
    expect(itemLocationLabel({ kind: 'inventory', equipped: false })).toBe('Inventory')
    expect(itemLocationLabel({ kind: 'location', location: cave })).toBe('Crystal Caverns')
    expect(itemLocationLabel({ kind: 'unresolved', text: 'the back room' })).toBe('the back room')
  })

  it('uses the translated name when asked and there is one', () => {
    const translated = { ...cave, translatedName: 'Kristallhöhlen' }
    expect(
      itemLocationLabel({ kind: 'location', location: translated }, { translated: true }),
    ).toBe('Kristallhöhlen')
    expect(itemLocationLabel({ kind: 'location', location: cave }, { translated: true })).toBe(
      'Crystal Caverns',
    )
  })

  it('does not show the id of a deleted location', () => {
    const text = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(itemLocationLabel({ kind: 'unresolved', text })).toBe('Unknown location')
    expect(itemLocationLabel({ kind: 'unresolved', text: '' })).toBe('Unknown location')
  })
})

describe('normalizeItemLocation', () => {
  const locations = [tavern, cave]
  const normalize = (overrides: Partial<Item>) =>
    normalizeItemLocation(item('a', overrides), locations)

  it("rewrites a location's name as its id", () => {
    expect(normalize({ location: 'crystal caverns' })).toEqual({ location: cave.id })
  })

  it('rewrites the options and empty text as the inventory', () => {
    expect(normalize({ location: 'worn' })).toEqual({ location: 'inventory', equipped: true })
    expect(normalize({ location: 'Inventory' })).toEqual({ location: 'inventory' })
    expect(normalize({ location: '' })).toEqual({ location: 'inventory' })
  })

  it('leaves current values, and text it cannot place, alone', () => {
    expect(normalize({})).toEqual({})
    expect(normalize({ location: cave.id })).toEqual({})
    expect(normalize({ location: 'ground' })).toEqual({})
    expect(normalize({ location: "in Aria's pack" })).toEqual({})
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    expect(normalizeItemLocation(item('a', { location: cave.id }), [override])).toEqual({})
  })

  it('unequips an item that is not in the inventory', () => {
    expect(normalize({ location: cave.id, equipped: true })).toEqual({ equipped: false })
    expect(normalize({ location: 'ground', equipped: true })).toEqual({ equipped: false })
  })
})

describe('normalizeItems', () => {
  it('rewrites legacy items and passes the rest through', () => {
    const current = item('Sword')
    const legacy = item('Cloak', { location: "kaelen's rest" })

    const [kept, rewritten] = normalizeItems([current, legacy], [tavern])
    expect(kept).toBe(current)
    expect(rewritten).toEqual({ ...legacy, location: tavern.id })
  })
})

describe('copiedLocationIds', () => {
  it("gives each location a new id, and maps an override's root id to the override's copy", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const ids = copiedLocationIds([tavern, override])

    expect(ids.size).toBe(3)
    expect(new Set([ids.get(tavern.id), ids.get(override.id)]).size).toBe(2)
    expect(ids.get(cave.id)).toBe(ids.get(override.id))
  })

  it('keeps the root its own id when the root is copied too', () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const ids = copiedLocationIds([cave, override])

    expect(ids.get(cave.id)).not.toBe(ids.get(override.id))
  })
})

describe('itemsAt', () => {
  it('finds items by id, for repointing on a merge', () => {
    const absorbed = location('The Crystal Caverns')
    const locations = [cave, absorbed, tavern]
    const lantern = item('Lantern', { location: absorbed.id })
    const elsewhere = item('Mug', { location: tavern.id })
    const held = item('Sword')
    expect(itemsAt([lantern, elsewhere, held], locations, new Set([absorbed.id]))).toEqual([
      lantern,
    ])
  })

  it("finds items left at the parent of a branch's override", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const lantern = item('Lantern', { location: cave.id })
    expect(itemsAt([lantern], [override], new Set([override.id]))).toEqual([lantern])
  })
})

describe('itemsToMoveOnDelete', () => {
  const lantern = item('Lantern', { location: cave.id })
  const items = [lantern, item('Sword')]

  it("moves a deleted location's items to the scene's location", () => {
    expect(itemsToMoveOnDelete(items, [cave, tavern], cave.id, tavern.id)).toEqual([lantern])
  })

  it('refuses when the items would have nowhere to go', () => {
    expect(itemsToMoveOnDelete(items, [cave, tavern], cave.id, cave.id)).toBeNull()
    expect(itemsToMoveOnDelete(items, [cave, tavern], cave.id, undefined)).toBeNull()
  })

  it('allows deleting an empty location, even the scene', () => {
    expect(itemsToMoveOnDelete(items, [cave, tavern], tavern.id, tavern.id)).toEqual([])
  })
})
