import { describe, it, expect } from 'vitest'
import type { Character, Item, Location } from '#lib/types/index.ts'
import {
  copiedLocationIds,
  itemLocationLabel,
  itemsAt,
  newItemLocation,
  normalizeItemLocation,
  normalizeItems,
  castNames,
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
  protagonistName: 'Aria',
  otherCharacterNames: ['Borin Ironfoot', 'The Captain'],
}

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

  it('stores worn and equipped as the inventory, equipped', () => {
    for (const said of [
      'worn',
      'Equipped',
      'worn by Aria',
      'around her neck',
      'worn on her left wrist',
      'equipped (main hand)',
      'is worn',
    ]) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: true,
      })
    }
  })

  it('stores what the protagonist carries as the inventory', () => {
    for (const said of [
      'inventory',
      'Inventory',
      "in Aria's inventory",
      'carried',
      'Aria',
      'in her pack',
      'on her belt',
      'in hand',
      'in her left hand',
      'on her back',
      'strapped to her back',
      'slung over her shoulder',
      'tucked in her belt behind the buckle',
      'stowed in pack',
      "protagonist's inventory",
      "player's inventory",
      'on you',
      'with me',
      'inside her coat',
      'in her saddlebag',
      'picked up from the floor',
      'given to you',
      'given to Aria',
      'being carried',
    ]) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: 'inventory',
        equipped: false,
      })
    }
  })

  it('stores an item someone else wears or carries at the scene', () => {
    for (const said of [
      'worn by Borin',
      'worn by borin',
      "in Borin's bag",
      'carried by Borin Ironfoot',
      'held by the Captain',
    ]) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
  })

  it('keeps an item that is only near the protagonist, or passed on, out of the inventory', () => {
    for (const said of [
      'on the table beside her pack',
      "in her sister's bag",
      'in her hand, then given to the guard',
      'around the neck of her horse',
      'not in inventory',
      'not carried',
      'no longer carried',
      'given to her',
      'handed to the guard',
      'handed over',
    ]) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
  })

  it('tells the protagonist from someone who shares a title', () => {
    const titled = { ...world, protagonistName: 'Aldric', otherCharacterNames: ['Sir Gareth'] }
    expect(newItemLocation({ location: 'Held by Sir Aldric' }, titled).location).toBe('inventory')
    const knights = { ...world, protagonistName: 'Sir Aldric', otherCharacterNames: ['Sir Gareth'] }
    expect(newItemLocation({ location: 'worn by Sir Aldric' }, knights)).toEqual({
      location: 'inventory',
      equipped: true,
    })
    expect(newItemLocation({ location: 'worn by Sir Gareth' }, knights).location).toBe(tavern.id)
  })

  it('does not read a placement word inside the name of a place', () => {
    for (const said of ['the holding cells', 'the Worn Bridge']) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
    const cells = location('Holding Cells')
    const listed = { ...world, locations: [tavern, cells] }
    expect(newItemLocation({ location: 'the holding cells' }, listed).location).toBe(cells.id)
  })

  it('finds a listed location behind a preposition or a parenthesis', () => {
    const cells = location('Holding Cells')
    const oakvale = location('Oakvale')
    const listed = {
      ...world,
      locations: [tavern, cells, oakvale],
      protagonistName: 'Aria of Oakvale',
    }
    for (const said of [
      'in the Holding Cells (back room)',
      'at the holding cells',
      'back at the Holding Cells',
    ]) {
      expect(newItemLocation({ location: said }, listed).location).toBe(cells.id)
    }
    expect(newItemLocation({ location: 'in Oakvale' }, listed).location).toBe(oakvale.id)
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

  it('stores ground, here and dropped as the scene location', () => {
    for (const said of ['ground', 'on the floor', 'here', 'dropped', 'dropped from her pack']) {
      expect(newItemLocation({ location: said }, world)).toEqual({
        location: tavern.id,
        equipped: false,
      })
    }
  })

  it('stores a name that matches no location as the scene location', () => {
    expect(newItemLocation({ location: 'the back room' }, world).location).toBe(tavern.id)
  })

  it('never stores the text it was given', () => {
    for (const said of ['the back room', 'ground', 'worn', 'somewhere']) {
      const { location: stored } = newItemLocation({ location: said }, world)
      expect([tavern.id, cave.id, 'inventory']).toContain(stored)
    }
  })

  it('passes an existing id and the inventory sentinel through', () => {
    expect(newItemLocation({ location: cave.id }, world).location).toBe(cave.id)
    expect(newItemLocation({ location: 'inventory' }, world).location).toBe('inventory')
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
    const nowhere = { ...world, currentLocationId: null }
    expect(newItemLocation({ location: 'ground' }, nowhere).location).toBe('inventory')
    expect(newItemLocation({ location: 'the back room' }, nowhere).location).toBe('inventory')
    expect(newItemLocation({ location: 'Crystal Caverns' }, nowhere).location).toBe(cave.id)
  })

  it("does not equip someone else's item that has nowhere else to go", () => {
    const nowhere = { ...world, currentLocationId: null }
    expect(newItemLocation({ location: 'worn by Borin', equipped: true }, nowhere)).toEqual({
      location: 'inventory',
      equipped: false,
    })
    expect(
      resolveItemLocation({ location: 'worn by Borin', equipped: true }, nowhere, item('Axe')),
    ).toEqual({
      location: 'inventory',
      equipped: false,
    })
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
    expect(resolveItemLocation({ equipped: true }, world, held)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('keeps equipped as it is when a held item stays held', () => {
    const equipped = item('Sword', { equipped: true })
    expect(resolveItemLocation({ location: 'carried' }, world, equipped)).toEqual({
      location: 'inventory',
      equipped: true,
    })
  })

  it('unequips an item the text says is not equipped', () => {
    const equipped = item('Sword', { equipped: true })
    for (const said of [
      'inventory (unequipped)',
      'inventory, not equipped',
      'unequipped',
      'not worn',
      'no longer equipped',
      'is not equipped',
    ]) {
      expect(resolveItemLocation({ location: said }, world, equipped)).toEqual({
        location: 'inventory',
        equipped: false,
      })
    }
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
    normalizeItemLocation(item('a', overrides), locations, { protagonistName: 'Aria' })

  it("rewrites a location's name as its id", () => {
    expect(normalize({ location: 'crystal caverns' })).toEqual({ location: cave.id })
  })

  it('rewrites worn and carried as the inventory', () => {
    expect(normalize({ location: 'worn' })).toEqual({ location: 'inventory', equipped: true })
    expect(normalize({ location: 'Inventory' })).toEqual({ location: 'inventory' })
    expect(normalize({ location: "in Aria's pack" })).toEqual({ location: 'inventory' })
  })

  it('leaves current values, and text it cannot place, alone', () => {
    expect(normalize({})).toEqual({})
    expect(normalize({ location: cave.id })).toEqual({})
    expect(normalize({ location: 'ground' })).toEqual({})
    expect(normalize({ location: 'worn by Borin' })).toEqual({})
    const override = location('Crystal Caverns', { id: 'loc-override', overridesId: cave.id })
    expect(normalizeItemLocation(item('a', { location: cave.id }), [override])).toEqual({})
  })

  it('unequips an item that is not in the inventory', () => {
    expect(normalize({ location: cave.id, equipped: true })).toEqual({ equipped: false })
    expect(normalize({ location: 'ground', equipped: true })).toEqual({ equipped: false })
  })
})

describe('normalizeItems', () => {
  it("rewrites legacy items with the protagonist's name, and passes the rest through", () => {
    const character = (name: string, relationship: string) =>
      ({ name, relationship }) as Partial<Character> as Character
    const cast = [character('Borin', 'companion'), character('Aria', 'self')]
    const current = item('Sword')
    const legacy = item('Cloak', { location: "in Aria's pack" })

    const [kept, rewritten] = normalizeItems([current, legacy], [tavern], cast)
    expect(kept).toBe(current)
    expect(rewritten).toEqual({ ...legacy, location: 'inventory' })
    expect(castNames(cast)).toEqual({ protagonistName: 'Aria', otherCharacterNames: ['Borin'] })
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
