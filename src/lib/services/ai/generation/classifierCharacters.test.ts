import { describe, it, expect } from 'vitest'
import type { Character } from '#lib/types/index.ts'
import {
  classifierCharacterView,
  formatExistingCharacters,
  planCharacterChanges,
  viewsBeforeApply,
  type ClassifierCharacterView,
} from './classifierCharacters'

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

describe('viewsBeforeApply', () => {
  it('looks a character up by name as the classifier writes it', () => {
    const views = viewsBeforeApply([character('Tomas', { status: 'inactive' })])
    expect(views('tomas')).toEqual(HIDDEN)
  })

  it('treats a name it does not know as created by this response', () => {
    expect(viewsBeforeApply([])('Newcomer')).toEqual(SHOWN)
  })

  it('keeps the view the classifier had, not a status changed since', () => {
    const tomas = character('Tomas', { status: 'inactive' })
    const views = viewsBeforeApply([tomas])
    tomas.status = 'active'
    expect(views('Tomas')).toEqual(HIDDEN)
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
        '  traits: wry, patient\n' +
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

  it('indents a line break in a description, so it cannot read as a name', () => {
    const text = formatExistingCharacters([
      character('Mira', { description: 'A pilot.\n- Tomas\nHer brother.' }),
    ])
    expect(text).toBe(
      '- Mira\n  status: active\n  description: A pilot.\n    - Tomas\n    Her brother.',
    )
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
    expect(plan).toEqual({
      changes: { description: 'A ferry pilot.', traits: ['wry', 'loyal'] },
      ignored: [],
    })
  })

  it('fills a description that was empty', () => {
    const plan = planCharacterChanges(character('Tomas'), { description: 'A smuggler.' }, SHOWN)
    expect(plan.changes).toEqual({ description: 'A smuggler.' })
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
    expect(plan.changes).toEqual({ visualDescriptors: { hair: 'short' } })
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
    expect(plan.changes).toEqual({ visualDescriptors: { hair: 'cropped' } })
  })

  it('writes nothing for a rewrite equal to the current value', () => {
    const plan = planCharacterChanges(
      mira,
      { description: 'A ferry pilot with a sore throat.', traits: ['wry', 'patient'] },
      SHOWN,
    )
    expect(plan).toEqual({ changes: {}, ignored: [] })
  })

  it('applies status and relationship as before', () => {
    expect(
      planCharacterChanges(mira, { status: 'deceased', relationship: 'rival' }, HIDDEN).changes,
    ).toEqual({ status: 'deceased', relationship: 'rival' })
  })

  it("keeps the protagonist's relationship, and gives nobody else 'self'", () => {
    const me = character('Me', { relationship: 'self' })
    expect(planCharacterChanges(me, { relationship: 'ally' }, SHOWN).changes).toEqual({})
    expect(planCharacterChanges(mira, { relationship: 'self' }, SHOWN).changes).toEqual({})
  })
})
