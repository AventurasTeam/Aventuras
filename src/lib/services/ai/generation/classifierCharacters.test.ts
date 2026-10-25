import { describe, it, expect } from 'vitest'
import type { Character } from '#lib/types/index.ts'
import {
  classifierCharacterView,
  formatExistingCharacters,
  planCharacterChanges,
  planRename,
  responseCast,
  shownCharacters,
  shownInPrompt,
  traitList,
  viewsForApply,
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

describe('responseCast', () => {
  const renamed = (c: Character, name: string) => ({ ...c, name })

  it('finds a renamed character by the name it was listed under or its new one', () => {
    const vendor = character('weapon vendor')
    const cast = responseCast([vendor, character('Mira')])
    const now = [renamed(vendor, 'Darek'), character('Mira')]
    expect(cast.find(now, 'Weapon Vendor')?.name).toBe('Darek')
    expect(cast.find(now, 'darek')?.name).toBe('Darek')
    expect(cast.listedName(now[0])).toBe('weapon vendor')
    expect(cast.find(now, 'Mira')?.name).toBe('Mira')
  })

  it('keeps two characters apart when one takes the name the other gave up', () => {
    const bob = character('Bob')
    const stranger = character('the stranger')
    const cast = responseCast([bob, stranger])
    const now = [renamed(bob, 'Robert'), renamed(stranger, 'Bob')]
    expect(cast.find(now, 'the stranger')?.id).toBe(stranger.id)
    expect(cast.find(now, 'Bob')?.id).toBe(bob.id)
    expect(cast.listedName(now[0])).toBe('Bob')
    expect(cast.listedName(now[1])).toBe('the stranger')
  })

  it('follows a character renamed twice in one response', () => {
    const woman = character('hooded woman')
    const cast = responseCast([woman])
    expect(cast.find([renamed(woman, 'Sera')], 'Sera')?.id).toBe(woman.id)
    const now = [renamed(woman, 'Seraphine')]
    expect(cast.find(now, 'hooded woman')?.id).toBe(woman.id)
    expect(cast.listedName(now[0])).toBe('hooded woman')
  })

  it('follows a character onto the override a write gave it', () => {
    const vendor = character('weapon vendor')
    const cast = responseCast([vendor])
    const override = { ...vendor, id: 'override', overridesId: vendor.id, name: 'Darek' }
    expect(cast.find([override], 'weapon vendor')?.id).toBe('override')
    expect(cast.listedName(override)).toBe('weapon vendor')
  })

  it('gives a character created by the response its own name', () => {
    const cast = responseCast([character('Mira')])
    expect(cast.listedName(character('Darek'))).toBe('Darek')
    expect(cast.find([character('Mira')], 'Darek')).toBeUndefined()
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
    expect(viewsForApply([], cast)('Mira')).toEqual(HIDDEN)
  })
})

describe('viewsForApply', () => {
  it('uses what the prompt listed, not the status at apply time', () => {
    const tomas = character('Tomas', { status: 'inactive' })
    const shown = shownCharacters([tomas])
    tomas.status = 'active'
    expect(viewsForApply(shown, [tomas])('tomas')).toEqual(HIDDEN)
  })

  it('treats a character that exists but was not listed as not shown', () => {
    expect(viewsForApply([], [character('Tomas')])('Tomas')).toEqual(HIDDEN)
  })

  it('treats a name nobody had as created by this response', () => {
    expect(viewsForApply([], [])('Newcomer')).toEqual(SHOWN)
  })

  it('treats a result without a list as having shown nobody', () => {
    const views = viewsForApply(undefined, [character('Tomas')])
    expect(views('Tomas')).toEqual(HIDDEN)
    expect(views('Newcomer')).toEqual(SHOWN)
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
