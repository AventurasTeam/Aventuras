import { describe, it, expect } from 'vitest'
import type { Character } from '#lib/types/index.ts'
import type { CharacterUpdate } from '../sdk/schemas/classifier'
import {
  classifierCharacterView,
  formatExistingCharacters,
  planCharacterChanges,
  planRename,
  planCharacterResponse,
  shownCharacters,
  shownInPrompt,
  traitList,
  shownView,
  type CharacterResponse,
  type CharacterResponsePlan,
  type ClassifierCharacterView,
} from './classifierCharacters'

describe('planRename', () => {
  const vendor = character('weapon vendor')
  const cast = [vendor, character('Mira'), character('Me', { relationship: 'self' })]

  it('gives a placeholder the name the story reveals', () => {
    expect(planRename(vendor, ' Darek ', cast)).toEqual({ name: 'Darek' })
  })

  it('is no change for the name the character already has', () => {
    expect(planRename(vendor, 'Weapon Vendor', cast)).toBeNull()
  })

  it('refuses a name another character holds, an empty one, and the protagonist', () => {
    expect(planRename(vendor, 'mira', cast)).toEqual({ refused: 'taken' })
    expect(planRename(vendor, '  ', cast)).toEqual({ refused: 'empty' })
    expect(planRename(cast[2], 'Someone', cast)).toEqual({ refused: 'protagonist' })
  })
})

describe('planCharacterResponse', () => {
  const me = character('Me', { relationship: 'self' })
  const vendor = character('weapon vendor', { description: 'Sells blades.' })
  const mira = character('Mira')
  const cast = [me, vendor, mira]
  const update = (name: string, changes: CharacterUpdate['changes']): CharacterUpdate => ({
    name,
    changes,
  })
  const plan = (
    response: Partial<CharacterResponse>,
    characters: Character[] = cast,
  ): CharacterResponsePlan =>
    planCharacterResponse(
      characters,
      { updates: [], newCharacters: [], presentNames: [], ...response },
      shownCharacters(characters),
    )

  it('renames a character and applies its other changes in one write', () => {
    const result = plan({
      updates: [
        update('weapon vendor', { newName: 'Darek', description: 'Sells blades. A veteran.' }),
      ],
      presentNames: ['Darek'],
    })
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].character.id).toBe(vendor.id)
    expect(result.updates[0].changes).toMatchObject({
      name: 'Darek',
      translatedName: null,
      description: 'Sells blades. A veteran.',
    })
    expect(result.creates).toEqual([])
    expect(result.presentNames).toEqual(['Darek'])
    expect(result.presentIds).toEqual([vendor.id])
  })

  it('finds a renamed character by its new name anywhere else in the response', () => {
    const result = plan({
      updates: [
        update('weapon vendor', { newName: 'Darek' }),
        update('Darek', { status: 'inactive' }),
      ],
      presentNames: ['weapon vendor'],
    })
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].changes).toMatchObject({ name: 'Darek', status: 'inactive' })
    expect(result.explicitStatusNames).toEqual(['Darek'])
    expect(result.presentNames).toEqual(['Darek'])
  })

  it('keeps two characters apart when one takes the name the other gave up', () => {
    const bob = character('Bob')
    const stranger = character('the stranger')
    const result = plan(
      {
        updates: [
          update('Bob', { newName: 'Robert' }),
          update('the stranger', { newName: 'Bob', description: 'A drifter.' }),
        ],
      },
      [bob, stranger],
    )
    const byId = new Map(result.updates.map((u) => [u.character.id, u.changes]))
    expect(byId.get(bob.id)).toEqual({ name: 'Robert', translatedName: null })
    expect(byId.get(stranger.id)).toMatchObject({ name: 'Bob', description: 'A drifter.' })
  })

  it('takes a name another rename frees later in the same response', () => {
    const bob = character('Bob')
    const stranger = character('the stranger')
    const result = plan(
      {
        updates: [update('the stranger', { newName: 'Bob' }), update('Bob', { newName: 'Robert' })],
      },
      [bob, stranger],
    )
    const byId = new Map(result.updates.map((u) => [u.character.id, u.changes.name]))
    expect(byId.get(bob.id)).toBe('Robert')
    expect(byId.get(stranger.id)).toBe('Bob')
    expect(result.refusedRenames).toEqual([])
  })

  it('refuses two renames that swap names', () => {
    const bob = character('Bob')
    const ann = character('Ann')
    const result = plan(
      { updates: [update('Bob', { newName: 'Ann' }), update('Ann', { newName: 'Bob' })] },
      [bob, ann],
    )
    expect(result.refusedRenames.map((r) => r.reason)).toEqual(['taken', 'taken'])
    expect(result.updates.every((u) => u.changes.name === undefined)).toBe(true)
  })

  it('follows a character renamed twice in one response, in either order', () => {
    for (const updates of [
      [update('weapon vendor', { newName: 'Sera' }), update('Sera', { newName: 'Seraphine' })],
      [update('Sera', { newName: 'Seraphine' }), update('weapon vendor', { newName: 'Sera' })],
    ]) {
      const result = plan({ updates })
      expect(result.updates).toHaveLength(1)
      expect(result.updates[0].changes.name).toBe('Seraphine')
      expect(result.creates).toEqual([])
    }
  })

  it('refuses a rename to a name someone holds, and the scene keeps the right character', () => {
    const result = plan({
      updates: [update('weapon vendor', { newName: 'Mira' })],
      presentNames: ['Mira'],
    })
    expect(result.refusedRenames).toEqual([
      { name: 'weapon vendor', newName: 'Mira', reason: 'taken' },
    ])
    expect(result.updates[0].changes).toEqual({})
    expect(result.presentIds).toEqual([mira.id])
  })

  it('never renames the protagonist', () => {
    const result = plan({ updates: [update('Me', { newName: 'Someone' })] })
    expect(result.refusedRenames[0].reason).toBe('protagonist')
  })

  it('does not add a renamed character again when newCharacters lists it under either name', () => {
    const result = plan({
      updates: [update('weapon vendor', { newName: 'Darek' })],
      newCharacters: [{ name: 'weapon vendor' }, { name: 'Darek' }],
    })
    expect(result.creates).toEqual([])
    expect(result.newNames).toEqual(['Darek', 'Darek'])
  })

  it('creates a character renamed before it was listed once, from its newCharacters entry', () => {
    const result = plan({
      updates: [update('the hooded woman', { newName: 'Mara' })],
      newCharacters: [{ name: 'the hooded woman', description: 'A smuggler.', traits: ['wary'] }],
      presentNames: ['Mara'],
    })
    expect(result.creates).toHaveLength(1)
    expect(result.creates[0].fields).toMatchObject({
      name: 'Mara',
      description: 'A smuggler.',
      traits: ['wary'],
      status: 'active',
    })
    expect(result.newNames).toEqual(['Mara'])
    expect(result.presentNames).toEqual(['Mara'])
  })

  it('finds a character it created under the placeholder name too', () => {
    const result = plan({
      updates: [
        update('the hooded woman', { newName: 'Mara' }),
        update('the hooded woman', { status: 'inactive' }),
      ],
      newCharacters: [{ name: 'the hooded woman' }],
    })
    expect(result.creates).toHaveLength(1)
    expect(result.creates[0].fields).toMatchObject({ name: 'Mara', status: 'inactive' })
    expect(result.explicitStatusNames).toEqual(['Mara'])
  })

  it('takes the newCharacters entry filed under the revealed name', () => {
    const result = plan({
      updates: [update('the hooded woman', { newName: 'Mara' })],
      newCharacters: [{ name: 'Mara', description: 'A smuggler.' }],
    })
    expect(result.creates).toHaveLength(1)
    expect(result.creates[0].fields).toMatchObject({ name: 'Mara', description: 'A smuggler.' })
  })

  it('sends an unmatched update with a new name to the character holding it', () => {
    const result = plan({
      updates: [update('the weapons vendor', { newName: 'Mira', status: 'inactive' })],
    })
    expect(result.creates).toEqual([])
    expect(result.updates[0].character.id).toBe(mira.id)
    expect(result.updates[0].changes).toEqual({ status: 'inactive' })
  })

  it('creates a character for an update naming no one', () => {
    const result = plan({ updates: [update('Tobin', { status: 'active' })] })
    expect(result.creates.map((c) => c.fields.name)).toEqual(['Tobin'])
    expect(result.updates).toEqual([])
  })

  it('adds a new character once, and nothing for one that exists', () => {
    const result = plan({
      newCharacters: [
        { name: 'Tobin', traits: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
        { name: 'mira' },
      ],
    })
    expect(result.creates).toHaveLength(1)
    expect(result.creates[0].fields.traits).toHaveLength(8)
  })

  it('gates rewrites by what the classifier was shown under the listed name', () => {
    const hidden = character('the guard', { status: 'inactive', description: 'Bored.' })
    const result = planCharacterResponse(
      [hidden],
      {
        updates: [update('the guard', { newName: 'Hal', description: 'Short.' })],
        newCharacters: [],
        presentNames: [],
      },
      shownCharacters([hidden]),
    )
    expect(result.updates[0].changes).toEqual({ name: 'Hal', translatedName: null })
    expect(result.updates[0].ignored).toEqual([{ field: 'description', reason: 'not shown' }])
  })

  it('keeps every update it applied as a source, for runtime variables', () => {
    const first = { status: 'inactive' as const }
    const second = { relationship: 'ally' }
    const result = plan({ updates: [update('Mira', first), update('Mira', second)] })
    expect(result.updates[0].sources).toEqual([first, second])
    expect(result.updates[0].changes).toEqual({
      status: 'inactive',
      relationship: 'ally',
      translatedRelationship: null,
    })
  })
})

describe('traitList', () => {
  it('keeps the first 8 distinct traits', () => {
    const traits = ['brave', 'Brave', ...Array.from({ length: 10 }, (_, i) => `trait ${i}`)]
    expect(traitList(traits)).toEqual([
      'brave',
      ...Array.from({ length: 7 }, (_, i) => `trait ${i}`),
    ])
  })
})

function character(name: string, overrides: Partial<Character> = {}): Character {
  return {
    id: `id-${name}`,
    storyId: 's1',
    name,
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: {},
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

const SHOWN: ClassifierCharacterView = { appearance: true, profile: true }
const HIDDEN: ClassifierCharacterView = { appearance: false, profile: false }

describe('classifierCharacterView', () => {
  it('shows an active character in full', () => {
    expect(classifierCharacterView(character('Mira'))).toEqual(SHOWN)
  })

  it('shows nothing rewritable of a character who is away or dead', () => {
    expect(classifierCharacterView(character('Mira', { status: 'inactive' }))).toEqual(HIDDEN)
    expect(classifierCharacterView(character('Mira', { status: 'deceased' }))).toEqual(HIDDEN)
  })

  it("shows the protagonist's appearance but not their description or traits", () => {
    expect(classifierCharacterView(character('Me', { relationship: 'self' }))).toEqual({
      appearance: true,
      profile: false,
    })
  })
})

describe('shownInPrompt', () => {
  const cast = [character('Mira')]
  const formatted = formatExistingCharacters(cast)

  it('lists the cast when the rendered prompt carries the character list', () => {
    expect(shownInPrompt(cast, formatted, ['system', `Characters:\n${formatted}`])).toEqual(
      shownCharacters(cast),
    )
  })

  it('lists nobody when a custom template leaves the character list out', () => {
    expect(shownInPrompt(cast, formatted, ['system', 'no list here'])).toEqual([])
    expect(shownView([], 'Mira')).toEqual(HIDDEN)
  })
})

describe('shownView', () => {
  it('uses what the prompt listed, not the status at apply time', () => {
    const tomas = character('Tomas', { status: 'inactive' })
    const shown = shownCharacters([tomas])
    tomas.status = 'active'
    expect(shownView(shown, 'tomas')).toEqual(HIDDEN)
  })

  it('treats a character that was not listed as not shown', () => {
    expect(shownView([], 'Tomas')).toEqual(HIDDEN)
  })

  it('treats a result without a list as having shown nobody', () => {
    expect(shownView(undefined, 'Tomas')).toEqual(HIDDEN)
  })
})

describe('formatExistingCharacters', () => {
  it('says so when there are none', () => {
    expect(formatExistingCharacters([])).toBe('(none)')
  })

  it('keeps the name alone on its line, with state indented under it', () => {
    const text = formatExistingCharacters([
      character('Ada (the elder)', { relationship: 'ally', status: 'inactive' }),
    ])
    expect(text).toBe('- Ada (the elder)\n  relationship: ally\n  status: inactive')
  })

  it('shows description, traits and appearance of an active character only', () => {
    const fields = {
      description: 'A ferry pilot with a sore throat.',
      traits: ['wry', 'patient'],
      visualDescriptors: { hair: 'silver braid', eyes: 'grey' },
    }
    const text = formatExistingCharacters([
      character('Mira', fields),
      character('Tomas', { ...fields, status: 'inactive' }),
    ])
    expect(text).toBe(
      '- Mira\n  status: active\n' +
        '  description: A ferry pilot with a sore throat.\n' +
        '  traits: ["wry","patient"]\n' +
        '  appearance: Hair: silver braid, Eyes: grey\n' +
        '- Tomas\n  status: inactive',
    )
  })

  it("leaves out the protagonist's description and traits", () => {
    const text = formatExistingCharacters([
      character('Me', {
        relationship: 'self',
        description: 'Written by the reader.',
        traits: ['stubborn'],
        visualDescriptors: { hair: 'red' },
      }),
    ])
    expect(text).toBe('- Me\n  relationship: self\n  status: active\n  appearance: Hair: red')
  })

  it('leaves out empty fields', () => {
    const text = formatExistingCharacters([
      character('Mira', { description: '  ', traits: [' '], visualDescriptors: { hair: '' } }),
    ])
    expect(text).toBe('- Mira\n  status: active')
  })

  it('indents a line break in any value, so it cannot read as a name', () => {
    const text = formatExistingCharacters([
      character('Mira', {
        description: 'A pilot.\n- Tomas\nHer brother.',
        traits: ['wry\n- Ada'],
        visualDescriptors: { clothing: 'grey coat\n- Ada' },
      }),
    ])
    expect(text).toBe(
      '- Mira\n  status: active\n' +
        '  description: A pilot.\n    - Tomas\n    Her brother.\n' +
        '  traits: ["wry\\n- Ada"]\n' +
        '  appearance: Clothing: grey coat\n    - Ada',
    )
  })

  it('keeps a blank line in a value', () => {
    const text = formatExistingCharacters([
      character('Mira', { description: 'A pilot.\n\nShe lost her brother.' }),
    ])
    expect(text).toBe(
      '- Mira\n  status: active\n  description: A pilot.\n\n    She lost her brother.',
    )
  })

  it('lists a trait holding a comma as one trait', () => {
    const text = formatExistingCharacters([
      character('Mira', { traits: ['fiercely loyal, even to a fault', 'wry'] }),
    ])
    expect(text).toContain('  traits: ["fiercely loyal, even to a fault","wry"]')
  })
})

describe('planCharacterChanges', () => {
  const mira = character('Mira', {
    description: 'A ferry pilot with a sore throat.',
    traits: ['wry', 'patient'],
    visualDescriptors: { hair: 'silver braid' },
  })

  it('replaces the description and the trait list of a shown character', () => {
    const plan = planCharacterChanges(
      mira,
      { description: ' A ferry pilot. ', traits: ['wry', ' Wry', 'loyal'] },
      SHOWN,
    )
    expect(plan.changes).toMatchObject({
      description: 'A ferry pilot.',
      traits: ['wry', 'loyal'],
    })
    expect(plan.ignored).toEqual([])
  })

  it('drops the translation of every field it rewrites', () => {
    const plan = planCharacterChanges(
      mira,
      {
        relationship: 'ally',
        description: 'A ferry pilot.',
        traits: ['loyal'],
        visualDescriptors: { hair: 'cropped' },
      },
      SHOWN,
    )
    expect(plan.changes).toMatchObject({
      translatedRelationship: null,
      translatedDescription: null,
      translatedTraits: null,
      translatedVisualDescriptors: null,
    })
  })

  it('fills a description that was empty', () => {
    const plan = planCharacterChanges(character('Tomas'), { description: 'A smuggler.' }, SHOWN)
    expect(plan.changes).toEqual({ description: 'A smuggler.', translatedDescription: null })
  })

  it('ignores rewrites of what the classifier was not shown', () => {
    const plan = planCharacterChanges(
      mira,
      { description: 'Gone.', traits: ['new'], visualDescriptors: { hair: 'cropped' } },
      HIDDEN,
    )
    expect(plan.changes).toEqual({})
    expect(plan.ignored).toEqual([
      { field: 'description', reason: 'not shown' },
      { field: 'traits', reason: 'not shown' },
      { field: 'visualDescriptors', reason: 'not shown' },
    ])
  })

  it("ignores a rewrite of the protagonist's description and traits, not their appearance", () => {
    const me = character('Me', { relationship: 'self', description: 'Written by the reader.' })
    const plan = planCharacterChanges(
      me,
      { description: 'Rewritten.', traits: ['brave'], visualDescriptors: { hair: 'short' } },
      classifierCharacterView(me),
    )
    expect(plan.changes).toEqual({
      visualDescriptors: { hair: 'short' },
      translatedVisualDescriptors: null,
    })
    expect(plan.ignored).toEqual([
      { field: 'description', reason: 'protagonist' },
      { field: 'traits', reason: 'protagonist' },
    ])
  })

  it('never erases with an empty value', () => {
    const plan = planCharacterChanges(
      mira,
      { description: '   ', traits: ['', ' '], visualDescriptors: { hair: ' ' } },
      SHOWN,
    )
    expect(plan.changes).toEqual({})
    expect(plan.ignored.map((i) => i.reason)).toEqual(['empty', 'empty', 'empty'])
  })

  it('drops blank appearance categories from a rewrite', () => {
    const plan = planCharacterChanges(
      mira,
      { visualDescriptors: { hair: 'cropped', eyes: '' } },
      SHOWN,
    )
    expect(plan.changes.visualDescriptors).toEqual({ hair: 'cropped' })
  })

  it('reads back a description as it was listed, without the indent', () => {
    const tomas = character('Tomas', { description: 'A pilot.\n\nShe lost her brother.' })
    const listed = 'A pilot.\n\n    She lost her brother.'
    expect(planCharacterChanges(tomas, { description: listed }, SHOWN).changes).toEqual({})
    expect(
      planCharacterChanges(tomas, { description: `${listed}\n    She found him.` }, SHOWN).changes
        .description,
    ).toBe('A pilot.\n\nShe lost her brother.\nShe found him.')
  })

  it('writes nothing for a rewrite equal to the current value', () => {
    const plan = planCharacterChanges(
      mira,
      {
        description: 'A ferry pilot with a sore throat.',
        traits: ['Patient', 'wry'],
        visualDescriptors: { hair: ' silver braid ', eyes: '' },
      },
      SHOWN,
    )
    expect(plan).toEqual({ changes: {}, ignored: [] })
  })

  it('applies status and relationship whatever the classifier was shown', () => {
    expect(
      planCharacterChanges(mira, { status: 'deceased', relationship: 'rival' }, HIDDEN).changes,
    ).toEqual({ status: 'deceased', relationship: 'rival', translatedRelationship: null })
  })

  it('makes no change for the status the character already has', () => {
    expect(planCharacterChanges(mira, { status: 'active' }, HIDDEN)).toEqual({
      changes: {},
      ignored: [],
    })
  })

  it("keeps the protagonist's relationship, and gives nobody else 'self'", () => {
    const me = character('Me', { relationship: 'self' })
    expect(planCharacterChanges(me, { relationship: 'ally' }, SHOWN).changes).toEqual({})
    expect(planCharacterChanges(mira, { relationship: 'self' }, SHOWN).changes).toEqual({})
  })
})
