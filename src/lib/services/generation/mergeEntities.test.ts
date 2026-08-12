import { describe, it, expect } from 'vitest'
import type { Character, Item, Location } from '$lib/types'
import {
  APPEND,
  applyMergePlan,
  hasConflicts,
  planCharacterMerge,
  planItemMerge,
  planLocationMerge,
  type MergePlan,
} from './mergeEntities'

const character = (name: string, over: Partial<Character> = {}): Character => ({
  id: `id-${name}`,
  storyId: 'story',
  name,
  description: null,
  relationship: null,
  traits: [],
  visualDescriptors: {},
  portrait: null,
  status: 'active',
  metadata: null,
  branchId: null,
  ...over,
})

const location = (name: string, over: Partial<Location> = {}): Location => ({
  id: `id-${name}`,
  storyId: 'story',
  name,
  description: null,
  visited: false,
  current: false,
  connections: [],
  metadata: null,
  branchId: null,
  ...over,
})

const item = (name: string, over: Partial<Item> = {}): Item => ({
  id: `id-${name}`,
  storyId: 'story',
  name,
  description: null,
  quantity: 1,
  equipped: false,
  location: 'inventory',
  metadata: null,
  branchId: null,
  ...over,
})

const field = (plan: MergePlan, key: string) => plan.fields.find((f) => f.key === key)!

/** The measured case: the row with the prose is the one carrying the wrong status. */
const morvana = () =>
  planCharacterMerge(
    character('Morvana', { description: 'The Demon Queen of Stygia.', status: 'deceased' }),
    [character('Morvana (surrendered devotee)', { relationship: 'Devoted partner' })],
  )

describe('what the plan says about each field', () => {
  it('marks a field only one row filled as settled, not as a choice', () => {
    expect(field(morvana(), 'relationship')).toMatchObject({
      origin: 'only',
      display: 'Devoted partner',
    })
  })

  it('marks a field the rows disagree on as a conflict, and offers both', () => {
    const status = field(morvana(), 'status')
    expect(status.origin).toBe('conflict')
    expect(status.candidates.map((c) => c.display)).toEqual(['deceased', 'active'])
    expect(status.candidates.map((c) => c.from)).toEqual([
      'Morvana',
      'Morvana (surrendered devotee)',
    ])
  })

  it('lets the user choose a status the old rule made unreachable', () => {
    // It used to take any non-`active` value from any row, so a living character stayed
    // dead whichever row was kept. Now it is a conflict like any other.
    const plan = morvana()
    field(plan, 'status').chosen = 1
    expect(applyMergePlan(plan).status).toBe('active')
  })

  it('defaults a conflict to the row the user chose to keep', () => {
    expect(applyMergePlan(morvana()).status).toBe('deceased')
  })

  it('says so when both rows agree, so nothing looks like a decision', () => {
    const plan = planCharacterMerge(character('a', { status: 'inactive' }), [
      character('b', { status: 'inactive' }),
    ])
    expect(field(plan, 'status').origin).toBe('agreed')
    expect(hasConflicts(plan)).toBe(false)
  })

  it('unions lists rather than putting them to a vote', () => {
    const plan = planCharacterMerge(character('a', { traits: ['proud', 'cruel'] }), [
      character('b', { traits: ['cruel', 'patient'] }),
    ])
    expect(field(plan, 'traits').origin).toBe('union')
    expect(applyMergePlan(plan).traits).toEqual(['proud', 'cruel', 'patient'])
  })

  it('fills missing appearance keys without overriding the kept row’s', () => {
    const plan = planCharacterMerge(character('a', { visualDescriptors: { hair: 'black' } }), [
      character('b', { visualDescriptors: { hair: 'white', eyes: 'amber' } }),
    ])
    expect(applyMergePlan(plan).visualDescriptors).toEqual({ hair: 'black', eyes: 'amber' })
  })

  it('keeps two different portraits apart even though both read as “image”', () => {
    const plan = planCharacterMerge(character('a', { portrait: 'data:a' }), [
      character('b', { portrait: 'data:b' }),
    ])
    expect(field(plan, 'portrait').candidates).toHaveLength(2)
    expect(field(plan, 'portrait').origin).toBe('conflict')
  })
})

describe('keeping both', () => {
  it('offers appending only where the values are prose', () => {
    const plan = planCharacterMerge(character('a', { description: 'One.', status: 'deceased' }), [
      character('b', { description: 'Two.' }),
    ])
    expect(field(plan, 'description').appendable).toBe(true)
    // A status cannot be two things at once.
    expect(field(plan, 'status').appendable).toBe(false)
  })

  it('joins the candidates when asked to keep both', () => {
    const plan = planCharacterMerge(character('a', { description: 'One.' }), [
      character('b', { description: 'Two.' }),
    ])
    field(plan, 'description').chosen = APPEND
    expect(applyMergePlan(plan).description).toBe('One.\n\nTwo.')
  })

  it('never offers appending when only one row has the text', () => {
    const plan = planCharacterMerge(character('a', { description: 'One.' }), [character('b')])
    expect(field(plan, 'description').appendable).toBe(false)
    expect(applyMergePlan(plan).description).toBe('One.')
  })

  it('does not repeat text the result already carries', () => {
    // The state a merge is re-run from after a failed removal: the primary holds the joined
    // text and the absorbed row still exists. A plain join would append its prose to itself.
    const plan = planCharacterMerge(character('a', { description: 'One.\n\nTwo.' }), [
      character('b', { description: 'Two.' }),
    ])
    field(plan, 'description').chosen = APPEND
    expect(applyMergePlan(plan).description).toBe('One.\n\nTwo.')
  })

  it('replaces a shorter text with a longer containing text regardless of candidate order', () => {
    const plan = planCharacterMerge(character('a', { description: 'Two.' }), [
      character('b', { description: 'One.\n\nTwo.' }),
    ])
    field(plan, 'description').chosen = APPEND
    expect(applyMergePlan(plan).description).toBe('One.\n\nTwo.')
  })

  it('does not treat sub-word substrings as matches (e.g. Gatto inside Cattedrale)', () => {
    const plan = planCharacterMerge(character('a', { description: 'La Cattedrale' }), [
      character('b', { description: 'Un bel Gatto' }),
    ])
    field(plan, 'description').chosen = APPEND
    expect(applyMergePlan(plan).description).toBe('La Cattedrale\n\nUn bel Gatto')
  })
})

describe('the other pools', () => {
  it('treats a visit as something only one row needs to have recorded', () => {
    const plan = planLocationMerge(location('a'), [location('b', { visited: true })])
    expect(applyMergePlan(plan).visited).toBe(true)
  })

  it('puts two quantities to the user rather than silently taking the larger', () => {
    const plan = planItemMerge(item('a', { quantity: 1 }), [item('b', { quantity: 5 })])
    expect(field(plan, 'quantity').origin).toBe('conflict')
    expect(applyMergePlan(plan).quantity).toBe(1)
  })

  it('omits a field no row filled instead of writing null over it', () => {
    // The result is spread into a `Partial<T>` update. `visited` is a boolean and `status`
    // is a three-value union: an absent key leaves the record alone, a null one does not.
    const plan = planLocationMerge(location('a'), [location('b')])
    expect('visited' in applyMergePlan(plan)).toBe(false)

    const chars = planCharacterMerge(character('a'), [character('b')])
    const merged = applyMergePlan(chars)
    expect('description' in merged).toBe(false)
    expect('portrait' in merged).toBe(false)
  })
})

describe('what a plan absorbs', () => {
  it('names the rows the merge will remove', () => {
    expect(morvana().absorbing).toEqual(['Morvana (surrendered devotee)'])
  })

  it('ignores the primary appearing among the others', () => {
    const primary = character('a')
    expect(planCharacterMerge(primary, [primary, character('b')]).absorbing).toEqual(['b'])
  })
})
