import { describe, it, expect } from 'vitest'
import type { Item, Location } from '#lib/types/index.ts'
import {
  copiedLocationIds,
  isEquipped,
  isInInventory,
  itemLocationLabel,
  itemsAt,
  normalizeItemLocation,
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
const world: ItemLocationWorld = {
  locations: [tavern, cave],
  currentLocationId: tavern.id,
  otherCharacterNames: ['Borin Ironfoot', 'The Captain'],
}

describe('resolveItemLocation for a new item', () => {
  it('stores the id of a location named exactly', () => {
    expect(resolveItemLocation({ location: 'Crystal Caverns' }, world)).toEqual({
      location: cave.id,
      equipped: false,
    })
  })

  it('matches a name across case, accents and punctuation', () => {
    expect(resolveItemLocation({ location: 'kaelens rest' }, world).location).toBe(tavern.id)
    expect(resolveItemLocation({ location: 'CRYSTAL  CAVERNS' }, world).location).toBe(cave.id)
    const named = { ...world, locations: [location('Élan Hall')] }
    expect(resolveItemLocation({ location: 'Elan hall' }, named).location).toBe('loc-Élan Hall')
  })

  it('stores worn and equipped as the inventory, equipped', () => {
    for (const said of ['worn', 'Equipped', 'worn by Aria']) {
      expect(resolveItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: true,
      })
    }
  })

  it('stores carried and inventory as the inventory', () => {
    for (const said of ['inventory', 'Inventory', "in Aria's inventory", 'carried']) {
      expect(resolveItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: false,
      })
    }
  })

  it('stores an item someone else wears or carries at the scene, not in the inventory', () => {
    for (const said of ['worn by Borin', "in Borin's bag", 'carried by Borin Ironfoot']) {
      expect(resolveItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
    // "The Captain" is named by its whole name only; "the" alone is no one.
    expect(resolveItemLocation({ location: 'held by the captain' }, world).location).toBe(tavern.id)
    expect(resolveItemLocation({ location: 'held in the bag' }, world).location).toBe('inventory')
  })

  it('matches a name given without its article', () => {
    const inn = location('The Pack Mule Inn')
    const withInn = { ...world, locations: [inn, cave] }
    expect(resolveItemLocation({ location: 'Pack Mule Inn' }, withInn).location).toBe(inn.id)
  })

  it('lets an explicit equipped: false win over worn', () => {
    expect(resolveItemLocation({ location: 'worn', equipped: false }, world)).toEqual({
      location: 'inventory',
      equipped: false,
    })
  })

  it("stores the root id of a branch's override, which every branch shares", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const onBranch = { ...world, locations: [tavern, override], currentLocationId: override.id }
    expect(resolveItemLocation({ location: 'Crystal Caverns' }, onBranch).location).toBe(cave.id)
    expect(resolveItemLocation({ location: 'ground' }, onBranch).location).toBe(cave.id)
  })

  it('stores ground, here and dropped as the scene location', () => {
    for (const said of ['ground', 'on the floor', 'here', 'dropped']) {
      expect(resolveItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
  })

  it('stores a name that matches no location as the scene location', () => {
    expect(resolveItemLocation({ location: 'the back room' }, world).location).toBe(tavern.id)
  })

  it('never stores the text it was given', () => {
    for (const said of ['the back room', 'ground', 'worn', 'somewhere']) {
      const { location: stored } = resolveItemLocation({ location: said }, world)
      expect([tavern.id, cave.id, 'inventory']).toContain(stored)
    }
  })

  it('passes an existing id and the inventory sentinel through', () => {
    expect(resolveItemLocation({ location: cave.id }, world).location).toBe(cave.id)
    expect(resolveItemLocation({ location: 'inventory' }, world).location).toBe('inventory')
  })

  it('defaults to the inventory, honouring equipped', () => {
    expect(resolveItemLocation({}, world)).toEqual({ location: 'inventory', equipped: false })
    expect(resolveItemLocation({ equipped: true }, world)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('cannot equip an item at a location', () => {
    expect(resolveItemLocation({ location: 'Crystal Caverns', equipped: true }, world)).toEqual({
      location: cave.id,
      equipped: false,
    })
  })

  it('goes to the inventory when there is no scene location to put it in', () => {
    const nowhere = { ...world, currentLocationId: null }
    expect(resolveItemLocation({ location: 'ground' }, nowhere).location).toBe('inventory')
    expect(resolveItemLocation({ location: 'the back room' }, nowhere).location).toBe('inventory')
    expect(resolveItemLocation({ location: 'Crystal Caverns' }, nowhere).location).toBe(cave.id)
  })

  it('resolves a location created in the same response', () => {
    // The store resolves items after the response's locations and scene change are applied.
    const newCave = location('Sunken Grotto', { current: true })
    const after = { locations: [tavern, cave, newCave], currentLocationId: newCave.id }
    expect(resolveItemLocation({ location: 'Sunken Grotto' }, after).location).toBe(newCave.id)
    expect(resolveItemLocation({ location: 'ground' }, after).location).toBe(newCave.id)
  })
})

describe('resolveItemLocation for an update', () => {
  const held = item('Sword')
  const lying = item('Lantern', { location: cave.id })

  it('changes nothing when nothing placement-related was said', () => {
    expect(resolveItemLocation({}, world, held)).toEqual({})
  })

  it('moves an item to a location and unequips it', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'ground' }, world, equipped)).toEqual({
      location: tavern.id,
      equipped: false,
    })
  })

  it('keeps the existing location when there is no scene location', () => {
    const nowhere = { ...world, currentLocationId: null }
    expect(resolveItemLocation({ location: 'ground' }, nowhere, lying)).toEqual({})
    expect(resolveItemLocation({ location: 'the back room' }, nowhere, held)).toEqual({})
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
    expect(resolveItemLocation({ equipped: true }, world, held)).toEqual({ equipped: true })
    expect(resolveItemLocation({ equipped: false }, world, held)).toEqual({ equipped: false })
  })

  it('keeps equipped as it is when a held item stays held', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'carried' }, world, equipped)).toEqual({
      location: 'inventory',
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

  it('reads a legacy location name as that location', () => {
    expect(readItemPlacement(item('a', { location: 'crystal caverns' }), locations)).toEqual({
      kind: 'location',
      location: cave,
    })
  })

  it('reads legacy worn as the inventory, equipped', () => {
    expect(readItemPlacement(item('a', { location: 'worn' }), locations)).toEqual({
      kind: 'inventory',
      equipped: true,
    })
  })

  it('reads legacy carried as the inventory', () => {
    expect(readItemPlacement(item('a', { location: 'Inventory' }), locations)).toEqual({
      kind: 'inventory',
      equipped: false,
    })
  })

  it('reads a placement word only when it stands alone', () => {
    expect(readItemPlacement(item('a', { location: 'worn by Borin' }), locations)).toEqual({
      kind: 'unresolved',
      text: 'worn by Borin',
    })
  })

  it('reads anything else as its text', () => {
    expect(readItemPlacement(item('a', { location: 'ground' }), locations)).toEqual({
      kind: 'unresolved',
      text: 'ground',
    })
    expect(readItemPlacement(item('a', { location: 'the back room' }), locations)).toEqual({
      kind: 'unresolved',
      text: 'the back room',
    })
  })

  it('does not count an equipped item at a location as equipped', () => {
    const odd = item('a', { location: cave.id, equipped: true })
    expect(isInInventory(odd, locations)).toBe(false)
    expect(isEquipped(odd, locations)).toBe(false)
    expect(isEquipped(item('a', { location: 'worn' }), locations)).toBe(true)
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

  it('rewrites a legacy value as what it reads as', () => {
    expect(normalizeItemLocation(item('a', { location: 'worn' }), locations)).toEqual({
      location: 'inventory',
      equipped: true,
    })
    expect(normalizeItemLocation(item('a', { location: 'Crystal Caverns' }), locations)).toEqual({
      location: cave.id,
    })
  })

  it('leaves current values, and text it cannot place, alone', () => {
    expect(normalizeItemLocation(item('a'), locations)).toEqual({})
    expect(normalizeItemLocation(item('a', { location: cave.id }), locations)).toEqual({})
    expect(normalizeItemLocation(item('a', { location: 'ground' }), locations)).toEqual({})
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    expect(normalizeItemLocation(item('a', { location: cave.id }), [override])).toEqual({})
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
  it('finds items by id and by legacy name, for repointing on a merge', () => {
    const absorbed = location('The Crystal Caverns')
    const locations = [cave, absorbed, tavern]
    const byId = item('Lantern', { location: absorbed.id })
    const byName = item('Rope', { location: 'the crystal caverns' })
    const elsewhere = item('Mug', { location: tavern.id })
    const held = item('Sword')
    expect(itemsAt([byId, byName, elsewhere, held], locations, new Set([absorbed.id]))).toEqual([
      byId,
      byName,
    ])
  })

  it("finds items left at the parent of a branch's override", () => {
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    const lantern = item('Lantern', { location: cave.id })
    expect(itemsAt([lantern], [override], new Set([override.id]))).toEqual([lantern])
  })
})
